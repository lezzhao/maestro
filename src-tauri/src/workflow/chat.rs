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
    append_run_record, current_time_ms,
};
use crate::workspace_io::WorkspaceIo;

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

pub async fn chat_save_last_conversation_core(
    app: AppHandle,
    payload: serde_json::Value,
) -> Result<(), CoreError> {
    let path = last_conversation_path(&app).await?;
    let text = serde_json::to_string_pretty(&payload)
        .map_err(|e| CoreError::Serialization { message: format!("serialize last conversation failed: {e}") })?;
    tokio::fs::write(&path, text)
        .await
        .map_err(|e| CoreError::Io { message: format!("write last conversation failed: {e}") })?;
    // Emit agent state update so frontend can sync (event-driven architecture)
    if let (Some(task_id), Some(messages)) = (
        payload.get("task_id").and_then(|v| v.as_str()),
        payload.get("messages").and_then(|v| v.as_array()),
    ) {
        let msgs: Vec<crate::agent_state::PersistedMessagePayload> = messages
            .iter()
            .filter_map(|m| {
                let id = m.get("id")?.as_str()?.to_string();
                let role = m.get("role")?.as_str().unwrap_or("user").to_string();
                let content = m.get("content")?.as_str().unwrap_or("").to_string();
                Some(crate::agent_state::PersistedMessagePayload { id, role, content })
            })
            .collect();
        if !msgs.is_empty() {
            crate::agent_state::emit_state_update(
                Some(&app),
                crate::agent_state::AgentStateUpdate::MessagesUpdated {
                    task_id: task_id.to_string(),
                    messages: msgs,
                },
            );
        }
    }
    Ok(())
}

#[command]
pub async fn chat_save_last_conversation(
    app: AppHandle,
    payload: serde_json::Value,
    core_state: State<'_, crate::core::MaestroCore>,
) -> Result<(), CoreError> {
    core_state.inner().chat_save_last_conversation(app, payload).await
}

pub async fn chat_load_last_conversation_core(
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
pub async fn chat_load_last_conversation(
    app: AppHandle,
    core_state: State<'_, crate::core::MaestroCore>,
) -> Result<Option<serde_json::Value>, CoreError> {
    core_state.inner().chat_load_last_conversation(app).await
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
    let (execution_id, resolved) = {
        let prepared = crate::execution_binding::resolve_execution(
            app.as_ref(),
            &request.engine_id,
            request.profile_id.as_deref(),
            "api",
            request.task_id.as_deref(),
            "chat_api",
            &cfg,
        )?;
        let id = prepared
            .execution_id
            .unwrap_or_else(|| format!("chat-api-{}-{}", request.engine_id, uuid::Uuid::new_v4()));
        (id, prepared.context)
    };
    let exec = resolved.to_execution_config();

    let provider = exec
        .api_provider
        .clone()
        .unwrap_or_else(|| "openai-compatible".to_string());
    let base_url = exec.api_base_url.clone().unwrap_or_default();
    let api_key = exec.api_key.clone().unwrap_or_default();
    let model = exec.model.clone().unwrap_or_default();
    let command = exec.command.clone();
    let engine_id = resolved.engine_id.clone();
    let profile_id = resolved.profile_id.clone().unwrap_or_else(|| "default".to_string());
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
        id: execution_id.clone(),
        engine_id: engine_id.to_string(),
        task_id: task_id.clone(),
        source: "chat_execute_api".to_string(),
        mode: ExecutionMode::Api,
        status: ExecutionStatus::Running,
        command: command.clone(),
        cwd: cfg.project.path.clone(),
        model: model.clone(),
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
    let root_path = std::path::PathBuf::from(&cfg.project.path);
    let io_opt = WorkspaceIo::new(&root_path).ok();
    let _ = on_data.send_string(format!("\u{0}RUN_ID:{run_id_for_return}"));

    // Emit run_created for event-driven frontend sync
    let run_payload = crate::agent_state::task_run_from_execution(
        &run_id_for_return,
        &task_id,
        &engine_id,
        "api",
        now_ms,
    );
    crate::agent_state::emit_state_update(
        app.as_ref(),
        crate::agent_state::AgentStateUpdate::RunCreated {
            task_id: task_id.clone(),
            run: run_payload,
        },
    );

    let exec_id_for_spawn = exec_id.clone();
    let headless_state_clone = headless_state.clone();
    let app_for_emit = app.clone();
    let task_id_for_emit = task_id.clone();
    let run_id_for_emit = run_id_for_return.clone();

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
        if let (Some(io), Ok(exec)) = (io_opt.as_ref(), execution) {
            if let Err(e) = append_run_record(io, &exec) {
                eprintln!("chat_execute_api: append_run_record failed: {e}");
            }
        }
        // Emit run_finished for event-driven frontend sync
        let (status, err) = match &run_result {
            Ok(_) => ("done", None),
            Err(e) => ("error", Some(e.clone())),
        };
        crate::agent_state::emit_state_update(
            app_for_emit.as_ref(),
            crate::agent_state::run_finished_payload(&task_id_for_emit, &run_id_for_emit, status, err),
        );
    });

    Ok(ChatExecuteApiResult {
        exec_id,
        run_id: run_id_for_return,
        engine_id,
        profile_id,
    })
}

#[command]
pub fn chat_execute_api_stop(
    request: ChatExecuteStopRequest,
    core_state: State<'_, crate::core::MaestroCore>,
) -> Result<(), CoreError> {
    core_state.inner().cancel_execution(&request.exec_id)
}

#[command]
pub async fn chat_execute_cli(
    app: AppHandle,
    request: ChatExecuteCliRequest,
    core_state: State<'_, crate::core::MaestroCore>,
    on_data: Channel<String>,
) -> Result<ChatExecuteCliResult, CoreError> {
    core_state
        .chat_execute_cli(Some(app), request, Arc::new(ChannelStringStream(on_data)))
        .await
}

pub async fn chat_execute_cli_core(
    app: Option<AppHandle>,
    request: ChatExecuteCliRequest,
    cfg: AppConfig,
    headless_state: &HeadlessProcessState,
    on_data: Arc<dyn StringStream>,
) -> Result<ChatExecuteCliResult, CoreError> {
    let (execution_id, resolved) = {
        let prepared = crate::execution_binding::resolve_execution(
            app.as_ref(),
            &request.engine_id,
            request.profile_id.as_deref(),
            "cli",
            request.task_id.as_deref(),
            "chat_cli",
            &cfg,
        )?;
        let id = prepared
            .execution_id
            .unwrap_or_else(|| format!("chat-cli-{}-{}", request.engine_id, uuid::Uuid::new_v4()));
        (id, prepared.context)
    };
    let exec = resolved.to_execution_config();

    let fallback_headless_args = builtin_headless_defaults(&resolved.engine_id);
    let supports_headless = exec.supports_headless || fallback_headless_args.is_some();
    if !supports_headless {
        return Err(CoreError::Unsupported { feature: "headless mode".to_string() });
    }

    let mut args = if !exec.headless_args.is_empty() {
        exec.headless_args.clone()
    } else if let Some(default_headless_args) = fallback_headless_args {
        default_headless_args
    } else {
        exec.args.clone()
    };
    args = with_model_args(args, &resolved.engine_id, &exec.model.clone().unwrap_or_default());
    if request.is_continuation && engine_supports_continue(&resolved.engine_id) {
        args.push("--continue".to_string());
    }
    args.push(request.prompt.clone());

    let command = exec.command.clone();
    let full_command_str = format!("{} {}", command, args.join(" "));
    let engine_id = resolved.engine_id.clone();
    let profile_id = resolved.profile_id.clone().unwrap_or_else(|| "default".to_string());
    if let Err(reason) = crate::plugin_engine::action_guard::ActionGuard::unwrap_default().check_command(&full_command_str) {
        return Err(CoreError::PermissionDenied { reason: format!("Blocked by ActionGuard: {reason}") });
    }
    let task_id = request.task_id.clone().unwrap_or_default();
    let cancel_token = CancellationToken::new();
    let runtime_engine = DefaultMaestroEngine;

    let now_ms = current_time_ms().unwrap_or_default();
    let execution = Execution {
        id: execution_id.clone(),
        engine_id: engine_id.to_string(),
        task_id: task_id.clone(),
        source: "chat_execute_cli".to_string(),
        mode: ExecutionMode::Cli,
        status: ExecutionStatus::Running,
        command: command.clone(),
        cwd: cfg.project.path.clone(),
        model: exec.model.clone().unwrap_or_default(),
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
    let root_path = std::path::PathBuf::from(&cfg.project.path);
    let io_opt = WorkspaceIo::new(&root_path).ok();
    let _ = on_data.send_string(format!("\u{0}RUN_ID:{run_id_for_return}"));

    // Emit run_created for event-driven frontend sync
    let run_payload = crate::agent_state::task_run_from_execution(
        &run_id_for_return,
        &task_id,
        &engine_id,
        "cli",
        now_ms,
    );
    crate::agent_state::emit_state_update(
        app.as_ref(),
        crate::agent_state::AgentStateUpdate::RunCreated {
            task_id: task_id.clone(),
            run: run_payload,
        },
    );

    let exec_id_for_spawn = exec_id.clone();
    let headless_state_clone = headless_state.clone();
    let app_for_emit = app.clone();
    let task_id_for_emit = task_id.clone();
    let run_id_for_emit = run_id_for_return.clone();
    let cwd = if cfg.project.path.trim().is_empty() {
        None
    } else {
        Some(cfg.project.path.clone())
    };
    let env = exec
        .env
        .iter()
        .map(|(k, v): (&String, &String)| (k.clone(), v.clone()))
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
        if let (Some(io), Ok(exec)) = (io_opt.as_ref(), execution) {
            if let Err(e) = append_run_record(io, &exec) {
                eprintln!("chat_execute_cli: append_run_record failed: {e}");
            }
        }
        // Emit run_finished for event-driven frontend sync
        let (status, err) = match &run_result {
            Ok(_) => ("done", None),
            Err(e) => ("error", Some(e.clone())),
        };
        crate::agent_state::emit_state_update(
            app_for_emit.as_ref(),
            crate::agent_state::run_finished_payload(&task_id_for_emit, &run_id_for_emit, status, err),
        );
    });

    Ok(ChatExecuteCliResult {
        exec_id,
        run_id: run_id_for_return,
        pid: None,
        engine_id: engine_id.to_string(),
        profile_id,
    })
}

#[command]
pub fn chat_execute_cli_stop(
    request: ChatExecuteStopRequest,
    core_state: State<'_, crate::core::MaestroCore>,
) -> Result<(), CoreError> {
    core_state.inner().cancel_execution(&request.exec_id)
}

pub fn chat_spawn_core(
    app: Option<&AppHandle>,
    request: ChatSpawnRequest,
    cfg: &crate::config::AppConfig,
    pty_state: &crate::pty::PtyManagerState,
    on_data: Channel<String>,
) -> Result<ChatSessionMeta, CoreError> {
    let prepared = crate::execution_binding::resolve_execution(
        app,
        &request.engine_id,
        request.profile_id.as_deref(),
        "cli",
        request.task_id.as_deref(),
        "chat_spawn",
        cfg,
    )?;
    let resolved = prepared.context;
    let exec = resolved.to_execution_config();

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

    let spawn: PtySessionInfo = pty_state.spawn_session(
        session_id,
        request.task_id.clone(),
        exec.command.clone(),
        with_model_args(exec.args.clone(), &resolved.engine_id, &exec.model.clone().unwrap_or_default()),
        if cfg.project.path.trim().is_empty() {
            None
        } else {
            Some(cfg.project.path.clone())
        },
        exec.env.clone().into_iter().collect(),
        request.cols.unwrap_or(120).clamp(60, 240),
        request.rows.unwrap_or(36).clamp(20, 80),
        bridge,
    ).map_err(|e| CoreError::ExecutionFailed { id: "chat_spawn".to_string(), reason: e })?;

    if let Some(ready_signal) = exec.ready_signal.as_deref() {
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
                std::thread::sleep(Duration::from_millis(50));
            }
        }
    }

    Ok(ChatSessionMeta {
        session_id: spawn.session_id.clone(),
        task_id: request.task_id.clone(),
        engine_id: resolved.engine_id,
        profile_id: resolved.profile_id.unwrap_or_else(|| "default".to_string()),
        ready_signal: exec.ready_signal.clone(),
    })
}

#[command]
pub async fn chat_spawn(
    app: AppHandle,
    request: ChatSpawnRequest,
    core_state: State<'_, crate::core::MaestroCore>,
    on_data: Channel<String>,
) -> Result<ChatSessionMeta, CoreError> {
    core_state.inner().chat_spawn(Some(app), request, on_data)
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
    core_state
        .inner()
        .pty_write(request.session_id.clone(), payload)
        .map_err(|e| CoreError::ExecutionFailed {
            id: request.session_id.clone(),
            reason: e,
        })
}

#[command]
pub fn chat_stop(
    request: ChatStopRequest,
    core_state: State<'_, crate::core::MaestroCore>,
) -> Result<(), CoreError> {
    core_state
        .inner()
        .pty_kill(request.session_id.clone())
        .map_err(|e| CoreError::ExecutionFailed {
            id: request.session_id.clone(),
            reason: e,
        })
}
