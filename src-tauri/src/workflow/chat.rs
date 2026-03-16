use super::types::*;
use super::util::{completion_matched, with_model_args};
use crate::core::events::{ChannelStringStream, StringStream};
use crate::config::AppConfig;
use crate::core::error::CoreError;
use crate::headless::HeadlessProcessState;
use crate::plugin_engine::maestro_engine::{
    ApiChatRequest, CliChatRequest, DefaultMaestroEngine, MaestroEngine,
};
use crate::pty::PtySessionInfo;
use crate::core::execution::{Execution, ExecutionMode, ExecutionStatus};
use crate::run_persistence::{
    append_run_record, current_time_ms, resolve_root_dir_from_project_path,
};

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{
    command,
    ipc::{Channel, InvokeResponseBody},
    AppHandle, Manager, State,
};
use tokio_util::sync::CancellationToken;

async fn last_conversation_path(app: &AppHandle) -> Result<PathBuf, CoreError> {
    let mut dir: PathBuf = app
        .path()
        .app_config_dir()
        .map_err(|e| CoreError::Io { message: format!("resolve app config dir failed: {e}") })?;
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| CoreError::Io { message: format!("create app config dir failed: {e}") })?;
    dir.push("last-conversation.json");
    Ok(dir)
}

fn resolve_profile(
    cfg: &crate::config::AppConfig,
    engine_id: &str,
    profile_id: Option<&str>,
) -> Result<crate::config::EngineProfile, CoreError> {
    let engine = cfg
        .engines
        .get(engine_id)
        .ok_or_else(|| CoreError::NotFound { resource: "engine".to_string(), id: engine_id.to_string() })?
        .clone();
    if let Some(pid) = profile_id {
        engine
            .profiles
            .get(pid)
            .cloned()
            .ok_or_else(|| CoreError::NotFound { resource: "profile".to_string(), id: pid.to_string() })
    } else {
        Ok(engine.active_profile())
    }
}

fn engine_supports_continue(engine_id: &str) -> bool {
    matches!(engine_id, "opencode" | "claude" | "gemini" | "codex")
}

fn builtin_headless_defaults(engine_id: &str) -> Option<Vec<String>> {
    match engine_id {
        "cursor" => Some(vec!["agent".to_string(), "--print".to_string()]),
        "claude" => Some(vec!["-p".to_string()]),
        "gemini" => Some(vec!["-p".to_string()]),
        "opencode" => Some(vec!["run".to_string()]),
        "codex" => Some(vec!["exec".to_string()]),
        _ => None,
    }
}

#[command]
pub async fn chat_save_last_conversation(
    app: AppHandle,
    payload: serde_json::Value,
) -> Result<(), CoreError> {
    let path = last_conversation_path(&app).await?;
    let text = serde_json::to_string_pretty(&payload)
        .map_err(|e| CoreError::Serialization { message: format!("serialize last conversation failed: {e}") })?;
    tokio::fs::write(path, text)
        .await
        .map_err(|e| CoreError::Io { message: format!("write last conversation failed: {e}") })
}

#[command]
pub async fn chat_load_last_conversation(
    app: AppHandle,
) -> Result<Option<serde_json::Value>, CoreError> {
    let path = last_conversation_path(&app).await?;
    if !path.exists() {
        return Ok(None);
    }
    let text = tokio::fs::read_to_string(path)
        .await
        .map_err(|e| CoreError::Io { message: format!("read last conversation failed: {e}") })?;
    let payload = serde_json::from_str::<serde_json::Value>(&text)
        .map_err(|e| CoreError::Serialization { message: format!("parse last conversation failed: {e}") })?;
    Ok(Some(payload))
}

#[command]
pub async fn chat_execute_api(
    app: AppHandle,
    request: ChatApiRequest,
    core_state: State<'_, crate::core::MaestroCore>,
    on_data: Channel<String>,
) -> Result<ChatExecuteApiResult, CoreError> {
    core_state
        .chat_execute_api(Some(app), request, Arc::new(ChannelStringStream(on_data)))
        .await
}

pub async fn chat_execute_api_core(
    app: Option<AppHandle>,
    request: ChatApiRequest,
    cfg: AppConfig,
    headless_state: &HeadlessProcessState,
    on_data: Arc<dyn StringStream>,
) -> Result<ChatExecuteApiResult, CoreError> {
    let profile = resolve_profile(&cfg, &request.engine_id, request.profile_id.as_deref())?;
    let provider = profile
        .api_provider()
        .unwrap_or_else(|| "openai-compatible".to_string());
    let base_url = profile.api_base_url().unwrap_or_default();
    let api_key = profile.api_key().unwrap_or_default();
    let model = profile.model().clone();
    let context = super::context_manager::build_chat_context(app.as_ref(), &request)
        .await
        .map_err(|reason| CoreError::ExecutionFailed {
            id: "chat-context".to_string(),
            reason,
        })?;
    let messages = context.messages.clone();
    let cancel_token = CancellationToken::new();
    let runtime_engine = DefaultMaestroEngine;
    let task_id = request.task_id.clone().unwrap_or_default();
    
    let now_ms = current_time_ms().unwrap_or_default();
    let execution = Execution {
        id: format!("chat-api-{}-{}", request.engine_id, uuid::Uuid::new_v4()),
        engine_id: request.engine_id.clone(),
        task_id: task_id.clone(),
        source: "chat_execute_api".to_string(),
        mode: ExecutionMode::Api,
        status: ExecutionStatus::Running,
        command: profile.command().clone(),
        cwd: cfg.project.path.clone(),
        model: profile.model().clone(),
        created_at: now_ms,
        updated_at: now_ms,
        log_path: None,
        output_preview: String::new(),
        verification: None,
        error: None,
        result: None,
        native_ref: None,
    };
    let run_id_for_return = execution.id.clone();
    let exec_id = headless_state.register(execution, cancel_token.clone());
    let on_data_clone = on_data.clone();
    let root_dir = resolve_root_dir_from_project_path(&cfg.project.path).ok();
    let _ = on_data.send_string(format!("\u{0}RUN_ID:{run_id_for_return}"));

    let exec_id_for_spawn = exec_id.clone();
    let headless_state_clone = headless_state.clone();

    tokio::spawn(async move {
        let run_result = runtime_engine
            .run_api_chat(
                ApiChatRequest {
                    provider,
                    base_url,
                    api_key,
                    model,
                    messages,
                },
                cancel_token,
                on_data_clone.clone(),
            )
            .await;
        if let Err(e) = match &run_result {
            Ok(_) => on_data_clone.send_string("\u{0}DONE".to_string()),
            Err(err) => on_data_clone.send_string(format!("\u{0}ERROR:{err}")),
        } {
            eprintln!("chat_execute_api: send DONE/ERROR failed: {e}");
        }
        let execution = match &run_result {
            Ok(_) => headless_state_clone.complete_and_extract(
                &exec_id_for_spawn,
                format!("input_tokens≈{}", context.estimate.approx_input_tokens),
                None,
            ),
            Err(err) => headless_state_clone.fail_and_extract(
                &exec_id_for_spawn,
                err.clone(),
                err.chars().take(300).collect::<String>(),
            ),
        };
        if let (Some(root), Ok(exec)) = (root_dir.as_ref(), execution) {
            if let Err(e) = append_run_record(root, &exec) {
                eprintln!("chat_execute_api: append_run_record failed: {e}");
            }
        }
    });

    Ok(ChatExecuteApiResult {
        exec_id,
        run_id: run_id_for_return,
        engine_id: request.engine_id,
        profile_id: profile.id,
    })
}

#[command]
pub fn chat_execute_api_stop(
    request: ChatExecuteStopRequest,
    core_state: State<'_, crate::core::MaestroCore>,
) -> Result<(), CoreError> {
    core_state.inner().headless_state.cancel(&request.exec_id.to_string()).map_err(|e| CoreError::CancelFailed { id: request.exec_id.to_string(), reason: e })
}

#[command]
pub async fn chat_execute_cli(
    request: ChatExecuteCliRequest,
    core_state: State<'_, crate::core::MaestroCore>,
    on_data: Channel<String>,
) -> Result<ChatExecuteCliResult, CoreError> {
    core_state
        .chat_execute_cli(request, Arc::new(ChannelStringStream(on_data)))
        .await
}

pub async fn chat_execute_cli_core(
    request: ChatExecuteCliRequest,
    cfg: AppConfig,
    headless_state: &HeadlessProcessState,
    on_data: Arc<dyn StringStream>,
) -> Result<ChatExecuteCliResult, CoreError> {
    let profile = resolve_profile(&cfg, &request.engine_id, request.profile_id.as_deref())?;
    let fallback_headless_args = builtin_headless_defaults(&request.engine_id);
    let supports_headless = profile.supports_headless() || fallback_headless_args.is_some();
    if !supports_headless {
        return Err(CoreError::Unsupported { feature: "headless mode".to_string() });
    }

    let mut args = if !profile.headless_args().is_empty() {
        profile.headless_args().clone()
    } else if let Some(default_headless_args) = fallback_headless_args {
        default_headless_args
    } else {
        profile.args().clone()
    };
    args = with_model_args(args, &request.engine_id, &profile.model());
    if request.is_continuation && engine_supports_continue(&request.engine_id) {
        args.push("--continue".to_string());
    }
    args.push(request.prompt.clone());

    let full_command_str = format!("{} {}", profile.command(), args.join(" "));
    if let Err(reason) = crate::plugin_engine::action_guard::ActionGuard::unwrap_default().check_command(&full_command_str) {
        return Err(CoreError::PermissionDenied { reason: format!("Blocked by ActionGuard: {reason}") });
    }
    let task_id = request.task_id.clone().unwrap_or_default();
    let cancel_token = CancellationToken::new();
    let runtime_engine = DefaultMaestroEngine;

    let now_ms = current_time_ms().unwrap_or_default();
    let execution = Execution {
        id: format!("chat-cli-{}-{}", request.engine_id, uuid::Uuid::new_v4()),
        engine_id: request.engine_id.clone(),
        task_id: task_id.clone(),
        source: "chat_execute_cli".to_string(),
        mode: ExecutionMode::Cli,
        status: ExecutionStatus::Running,
        command: profile.command().clone(),
        cwd: cfg.project.path.clone(),
        model: profile.model().clone(),
        created_at: now_ms,
        updated_at: now_ms,
        log_path: None,
        output_preview: String::new(),
        verification: None,
        error: None,
        result: None,
        native_ref: None,
    };
    let run_id_for_return = execution.id.clone();
    let exec_id = headless_state.register(execution, cancel_token.clone());
    let on_data_clone = on_data.clone();
    let root_dir = resolve_root_dir_from_project_path(&cfg.project.path).ok();
    let _ = on_data.send_string(format!("\u{0}RUN_ID:{run_id_for_return}"));

    let exec_id_for_spawn = exec_id.clone();
    let headless_state_clone = headless_state.clone();
    let command = profile.command().clone();
    let cwd = if cfg.project.path.trim().is_empty() {
        None
    } else {
        Some(cfg.project.path.clone())
    };
    let env = profile
        .env()
        .iter()
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect::<Vec<_>>();

    tokio::spawn(async move {
        let run_result = runtime_engine
            .run_cli_chat(
                CliChatRequest {
                    command,
                    args,
                    cwd,
                    env,
                },
                cancel_token,
                on_data_clone.clone(),
            )
            .await;

        match &run_result {
            Ok(out) => {
                if let Some(ref v) = out.verification {
                    if let Ok(json) = serde_json::to_string(v) {
                        let _ = on_data_clone.send_string(format!("\u{0}VERIFICATION:{json}"));
                    }
                }
                let code = out.exit_code.unwrap_or(-1);
                let _ = on_data_clone.send_string(format!("\u{0}EXIT:{code}"));
            }
            Err(err) => {
                let _ = on_data_clone.send_string(format!("\u{0}ERROR:{err}"));
            }
        }

        let execution = match &run_result {
            Ok(out) => {
                let output_preview = out.output_snapshot.chars().take(300).collect::<String>();
                if out.exit_code.unwrap_or(-1) == 0 {
                    headless_state_clone.complete_and_extract(
                        &exec_id_for_spawn,
                        output_preview,
                        out.verification.clone(),
                    )
                } else {
                    headless_state_clone.fail_and_extract(
                        &exec_id_for_spawn,
                        format!("exit code: {}", out.exit_code.unwrap_or(-1)),
                        output_preview,
                    )
                }
            }
            Err(err) => headless_state_clone.fail_and_extract(
                &exec_id_for_spawn,
                err.to_string(),
                err.to_string().chars().take(300).collect::<String>(),
            ),
        };
        if let (Some(root), Ok(exec)) = (root_dir.as_ref(), execution) {
            if let Err(e) = append_run_record(root, &exec) {
                eprintln!("chat_execute_cli: append_run_record failed: {e}");
            }
        }
    });

    Ok(ChatExecuteCliResult {
        exec_id,
        run_id: run_id_for_return,
        pid: None,
        engine_id: request.engine_id,
        profile_id: profile.id,
    })
}

#[command]
pub fn chat_execute_cli_stop(
    request: ChatExecuteStopRequest,
    core_state: State<'_, crate::core::MaestroCore>,
) -> Result<(), CoreError> {
    core_state.inner().headless_state.cancel(&request.exec_id.to_string()).map_err(|e| CoreError::CancelFailed { id: request.exec_id.to_string(), reason: e })
}

#[command]
pub async fn chat_spawn(
    request: ChatSpawnRequest,
    core_state: State<'_, crate::core::MaestroCore>,
    on_data: Channel<String>,
) -> Result<ChatSessionMeta, CoreError> {
    let cfg = core_state.inner().config.get();
    let engine = cfg
        .engines
        .get(&request.engine_id)
        .ok_or_else(|| CoreError::NotFound { resource: "engine".to_string(), id: request.engine_id.clone() })?
        .clone();
    let profile = if let Some(profile_id) = request.profile_id.as_deref() {
        engine.profiles.get(profile_id).cloned().ok_or_else(|| {
            CoreError::NotFound { resource: "profile".to_string(), id: profile_id.to_string() }
        })?
    } else {
        engine.active_profile()
    };

    *core_state
        .inner()
        .engine_runtime
        .active_engine_id
        .lock()
        .expect("active_engine lock poisoned") = Some(request.engine_id.clone());

    let output_buf = Arc::new(Mutex::new(String::new()));
    let output_buf_ch = Arc::clone(&output_buf);
    let bridge = Channel::new(move |chunk: InvokeResponseBody| {
        let text = match chunk {
            InvokeResponseBody::Json(s) => s,
            InvokeResponseBody::Raw(bytes) => String::from_utf8_lossy(&bytes).to_string(),
        };
        {
            let mut buf = output_buf_ch.lock().expect("chat output lock poisoned");
            buf.push_str(&text);
            if buf.len() > 1_000_000 {
                let drop_prefix = buf.len() - 1_000_000;
                buf.drain(..drop_prefix);
            }
        }
        let _ = on_data.send(text);
        Ok(())
    });

    let session_id = uuid::Uuid::new_v4().to_string();

    let spawn: PtySessionInfo = core_state.inner().pty_state.spawn_session(
        session_id,
        profile.command().clone(),
        with_model_args(profile.args().clone(), &request.engine_id, &profile.model()),
        if cfg.project.path.trim().is_empty() {
            None
        } else {
            Some(cfg.project.path.clone())
        },
        profile.env().clone().into_iter().collect(),
        request.cols.unwrap_or(120).clamp(60, 240),
        request.rows.unwrap_or(36).clamp(20, 80),
        bridge,
    )?;

    if let Some(ready_signal) = profile.ready_signal().as_deref() {
        if !ready_signal.trim().is_empty() {
            let deadline = Instant::now() + Duration::from_millis(10_000);
            while Instant::now() < deadline {
                let snap = output_buf
                    .lock()
                    .expect("chat output lock poisoned")
                    .clone();
                if completion_matched(Some(ready_signal), &snap) {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        }
    }

    Ok(ChatSessionMeta {
        session_id: spawn.session_id.clone(),
        engine_id: request.engine_id,
        profile_id: profile.id.clone(),
        ready_signal: profile.ready_signal(),
    })
}

#[command]
pub fn chat_send(
    request: ChatSendRequest,
    core_state: State<'_, crate::core::MaestroCore>,
) -> Result<(), CoreError> {
    let payload = if request.append_newline.unwrap_or(true) {
        format!("{}\n", request.content)
    } else {
        request.content
    };
    core_state.inner().pty_state.write_to_session(Some(request.session_id.to_string()), &payload).map_err(|e| CoreError::ExecutionFailed { id: request.session_id.clone(), reason: e })
}

#[command]
pub fn chat_stop(
    request: ChatStopRequest,
    core_state: State<'_, crate::core::MaestroCore>,
) -> Result<(), CoreError> {
    core_state.inner().pty_state.kill_session(&request.session_id.to_string()).map_err(|e| CoreError::ExecutionFailed { id: request.session_id.clone(), reason: e })
}
