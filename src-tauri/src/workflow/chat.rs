use crate::config::AppConfigState;
use crate::engine::EngineRuntimeState;
use crate::headless::HeadlessProcessState;
use crate::pty::{PtyManagerState, PtySessionInfo};
use crate::run_persistence::{
    append_run_record, current_time_ms, resolve_root_dir_from_project_path, UnifiedRunRecord,
};
use super::types::*;
use super::util::{completion_matched, with_model_args};
use regex::Regex;
use std::fs;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{
    command,
    ipc::{Channel, InvokeResponseBody},
    AppHandle, Manager, State,
};
use tokio::io::AsyncReadExt;

fn last_conversation_path(app: &AppHandle) -> Result<PathBuf, String> {
    let mut dir: PathBuf = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("resolve app config dir failed: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("create app config dir failed: {e}"))?;
    dir.push("last-conversation.json");
    Ok(dir)
}

fn resolve_profile(
    cfg: &crate::config::AppConfig,
    engine_id: &str,
    profile_id: Option<&str>,
) -> Result<crate::config::EngineProfile, String> {
    let engine = cfg
        .engines
        .get(engine_id)
        .ok_or_else(|| format!("engine not found: {engine_id}"))?
        .clone();
    if let Some(pid) = profile_id {
        engine
            .profiles
            .get(pid)
            .cloned()
            .ok_or_else(|| format!("profile not found for engine {engine_id}: {pid}"))
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

fn parse_case_counts(output: &str) -> (usize, usize, usize, usize) {
    let passed_re = Regex::new(r"(?i)\b(\d+)\s+passed\b").expect("regex must compile");
    let failed_re = Regex::new(r"(?i)\b(\d+)\s+failed\b").expect("regex must compile");
    let skipped_re = Regex::new(r"(?i)\b(\d+)\s+(skipped|todo|pending)\b").expect("regex must compile");
    let total_re = Regex::new(r"(?i)\b(\d+)\s+total\b").expect("regex must compile");
    let passed = passed_re
        .captures_iter(output)
        .filter_map(|cap| cap.get(1).and_then(|m| m.as_str().parse::<usize>().ok()))
        .last()
        .unwrap_or(0);
    let failed = failed_re
        .captures_iter(output)
        .filter_map(|cap| cap.get(1).and_then(|m| m.as_str().parse::<usize>().ok()))
        .last()
        .unwrap_or(0);
    let skipped = skipped_re
        .captures_iter(output)
        .filter_map(|cap| cap.get(1).and_then(|m| m.as_str().parse::<usize>().ok()))
        .last()
        .unwrap_or(0);
    let mut total = total_re
        .captures_iter(output)
        .filter_map(|cap| cap.get(1).and_then(|m| m.as_str().parse::<usize>().ok()))
        .last()
        .unwrap_or(0);
    if total == 0 {
        total = passed + failed + skipped;
    }
    (total, passed, failed, skipped)
}

fn detect_framework(output: &str) -> Option<String> {
    let lower = output.to_lowercase();
    if lower.contains("vitest") {
        return Some("vitest".to_string());
    }
    if lower.contains("jest") {
        return Some("jest".to_string());
    }
    if lower.contains("playwright") {
        return Some("playwright".to_string());
    }
    if lower.contains("cypress") {
        return Some("cypress".to_string());
    }
    None
}

fn extract_verification_summary(output: &str) -> Option<VerificationSummary> {
    let framework = detect_framework(output)?;
    let (total_cases, passed_cases, failed_cases, skipped_cases) = parse_case_counts(output);
    let success = failed_cases == 0;
    Some(VerificationSummary {
        has_verification: true,
        test_run: Some(TestRunSummary {
            framework,
            success,
            total_suites: 0,
            passed_suites: 0,
            failed_suites: 0,
            total_cases,
            passed_cases,
            failed_cases,
            skipped_cases,
            duration_ms: None,
            suites: vec![TestSuiteResult {
                name: "chat-exec".to_string(),
                total_cases,
                passed_cases,
                failed_cases,
                skipped_cases,
                duration_ms: None,
                cases: vec![],
            }],
            raw_summary: None,
        }),
        source: Some("chat-exec-parser".to_string()),
        notes: None,
    })
}

async fn forward_output<R>(reader: R, on_data: Channel<String>, aggregate: Arc<Mutex<String>>)
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut stream = reader;
    let mut buffer = vec![0_u8; 4096];
    loop {
        match stream.read(&mut buffer).await {
            Ok(0) => break,
            Ok(size) => {
                let chunk = String::from_utf8_lossy(&buffer[..size]).to_string();
                {
                    let mut text = aggregate.lock().expect("chat aggregate lock poisoned");
                    text.push_str(&chunk);
                    if text.len() > 1_500_000 {
                        let drop_prefix = text.len() - 1_500_000;
                        text.drain(..drop_prefix);
                    }
                }
                let _ = on_data.send(chunk);
            }
            Err(_) => break,
        }
    }
}

#[command]
pub async fn chat_save_last_conversation(
    app: AppHandle,
    payload: serde_json::Value,
) -> Result<(), String> {
    let path = last_conversation_path(&app)?;
    let text = serde_json::to_string_pretty(&payload)
        .map_err(|e| format!("serialize last conversation failed: {e}"))?;
    tokio::fs::write(path, text).await.map_err(|e| format!("write last conversation failed: {e}"))
}

#[command]
pub async fn chat_load_last_conversation(app: AppHandle) -> Result<Option<serde_json::Value>, String> {
    let path = last_conversation_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    let text = tokio::fs::read_to_string(path).await.map_err(|e| format!("read last conversation failed: {e}"))?;
    let payload = serde_json::from_str::<serde_json::Value>(&text)
        .map_err(|e| format!("parse last conversation failed: {e}"))?;
    Ok(Some(payload))
}

#[command]
pub async fn chat_execute_api(
    request: ChatApiRequest,
    config_state: State<'_, AppConfigState>,
    headless_state: State<'_, HeadlessProcessState>,
    on_data: Channel<String>,
) -> Result<ChatExecuteApiResult, String> {
    let cfg = config_state.get();
    let profile = resolve_profile(&cfg, &request.engine_id, request.profile_id.as_deref())?;
    let provider = profile
        .api_provider
        .clone()
        .unwrap_or_else(|| "openai-compatible".to_string());
    let base_url = profile.api_base_url.clone().unwrap_or_default();
    let api_key = profile.api_key.clone().unwrap_or_default();
    let model = profile.model.clone();
    let messages = request.messages.clone();
    let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel();
    let exec_id = headless_state.register(cancel_tx);
    let run_id = format!("chat-api-{}-{exec_id}", request.engine_id);
    let run_id_for_return = run_id.clone();
    let task_id = request.task_id.clone().unwrap_or_default();
    let entries = headless_state.clone_entries();
    let on_data_clone = on_data.clone();
    let root_dir = resolve_root_dir_from_project_path(&cfg.project.path).ok();
    let engine_id = request.engine_id.clone();
    let profile_command = profile.command.clone();
    let profile_model = profile.model.clone();
    let cwd = cfg.project.path.clone();
    let _ = on_data.send(format!("\u{0}RUN_ID:{run_id_for_return}"));

    tokio::spawn(async move {
        let run_result = crate::api_provider::stream_chat(
            &provider,
            &base_url,
            &api_key,
            &model,
            &messages,
            cancel_rx,
            on_data_clone.clone(),
        )
        .await;
        match run_result {
            Ok(_) => {
                let _ = on_data_clone.send("\u{0}DONE".to_string());
                if let (Some(root), Ok(now_ms)) = (root_dir.as_ref(), current_time_ms()) {
                    let _ = append_run_record(
                        root,
                        &UnifiedRunRecord {
                            run_id: run_id.clone(),
                            engine_id: engine_id.clone(),
                            task_id: task_id.clone(),
                            source: "chat_execute_api".to_string(),
                            mode: "api".to_string(),
                            status: "done".to_string(),
                            command: profile_command.clone(),
                            cwd: cwd.clone(),
                            model: profile_model.clone(),
                            created_at: now_ms,
                            updated_at: now_ms,
                            output_preview: String::new(),
                            verification: None,
                        },
                    );
                }
            }
            Err(err) => {
                let _ = on_data_clone.send(format!("\u{0}ERROR:{err}"));
                if let (Some(root), Ok(now_ms)) = (root_dir.as_ref(), current_time_ms()) {
                    let _ = append_run_record(
                        root,
                        &UnifiedRunRecord {
                            run_id: run_id.clone(),
                            engine_id: engine_id.clone(),
                            task_id: task_id.clone(),
                            source: "chat_execute_api".to_string(),
                            mode: "api".to_string(),
                            status: "error".to_string(),
                            command: profile_command.clone(),
                            cwd: cwd.clone(),
                            model: profile_model.clone(),
                            created_at: now_ms,
                            updated_at: now_ms,
                            output_preview: err.chars().take(300).collect(),
                            verification: None,
                        },
                    );
                }
            }
        }
        entries
            .lock()
            .expect("headless process lock poisoned")
            .remove(&exec_id);
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
    headless_state: State<'_, HeadlessProcessState>,
) -> Result<(), String> {
    headless_state.cancel(request.exec_id)
}

#[command]
pub async fn chat_execute_cli(
    request: ChatExecuteCliRequest,
    config_state: State<'_, AppConfigState>,
    headless_state: State<'_, HeadlessProcessState>,
    on_data: Channel<String>,
) -> Result<ChatExecuteCliResult, String> {
    let cfg = config_state.get();
    let profile = resolve_profile(&cfg, &request.engine_id, request.profile_id.as_deref())?;
    let fallback_headless_args = builtin_headless_defaults(&request.engine_id);
    let supports_headless = profile.supports_headless || fallback_headless_args.is_some();
    if !supports_headless {
        return Err(format!("engine {} does not support headless mode", request.engine_id));
    }

    let mut args = if !profile.headless_args.is_empty() {
        profile.headless_args.clone()
    } else if let Some(default_headless_args) = fallback_headless_args {
        default_headless_args
    } else {
        profile.args.clone()
    };
    args = with_model_args(args, &request.engine_id, &profile.model);
    if request.is_continuation && engine_supports_continue(&request.engine_id) {
        args.push("--continue".to_string());
    }
    args.push(request.prompt.clone());

    let mut command = tokio::process::Command::new(&profile.command);
    command.args(args);
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    if !cfg.project.path.trim().is_empty() {
        command.current_dir(&cfg.project.path);
    }
    for (k, v) in &profile.env {
        command.env(k, v);
    }

    let mut child = command
        .spawn()
        .map_err(|e| format!("spawn failed: {e}"))?;
    let pid = child.id();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let (cancel_tx, mut cancel_rx) = tokio::sync::oneshot::channel();
    let exec_id = headless_state.register(cancel_tx);
    let run_id = format!("chat-cli-{}-{exec_id}", request.engine_id);
    let run_id_for_return = run_id.clone();
    let task_id = request.task_id.clone().unwrap_or_default();
    let entries = headless_state.clone_entries();
    let on_data_clone = on_data.clone();
    let aggregate = Arc::new(Mutex::new(String::new()));
    let root_dir = resolve_root_dir_from_project_path(&cfg.project.path).ok();
    let engine_id = request.engine_id.clone();
    let profile_command = profile.command.clone();
    let profile_model = profile.model.clone();
    let cwd = cfg.project.path.clone();
    let _ = on_data.send(format!("\u{0}RUN_ID:{run_id_for_return}"));

    tokio::spawn(async move {
        let stdout_aggregate = Arc::clone(&aggregate);
        let stderr_aggregate = Arc::clone(&aggregate);
        let stdout_task = stdout
            .map(|out| tokio::spawn(forward_output(out, on_data_clone.clone(), stdout_aggregate)));
        let stderr_task = stderr
            .map(|err| tokio::spawn(forward_output(err, on_data_clone.clone(), stderr_aggregate)));

        let wait_result = tokio::select! {
            _ = &mut cancel_rx => {
                let _ = child.start_kill();
                child.wait().await
            }
            status = child.wait() => status
        };

        if let Some(task) = stdout_task {
            let _ = task.await;
        }
        if let Some(task) = stderr_task {
            let _ = task.await;
        }

        let output_snapshot = aggregate
            .lock()
            .expect("chat aggregate lock poisoned")
            .clone();
        let verification = extract_verification_summary(&output_snapshot);
        if let Some(verification) = verification.clone() {
            if let Ok(json) = serde_json::to_string(&verification) {
                let _ = on_data_clone.send(format!("\u{0}VERIFICATION:{json}"));
            }
        }

        match wait_result {
            Ok(status) => {
                let code = status.code().unwrap_or(-1);
                let _ = on_data_clone.send(format!("\u{0}EXIT:{code}"));
                if let (Some(root), Ok(now_ms)) = (root_dir.as_ref(), current_time_ms()) {
                    let _ = append_run_record(
                        root,
                        &UnifiedRunRecord {
                            run_id: run_id.clone(),
                            engine_id: engine_id.clone(),
                            task_id: task_id.clone(),
                            source: "chat_execute_cli".to_string(),
                            mode: "cli".to_string(),
                            status: if code == 0 {
                                "done".to_string()
                            } else {
                                "error".to_string()
                            },
                            command: profile_command.clone(),
                            cwd: cwd.clone(),
                            model: profile_model.clone(),
                            created_at: now_ms,
                            updated_at: now_ms,
                            output_preview: output_snapshot.chars().take(300).collect(),
                            verification: verification.clone(),
                        },
                    );
                }
            }
            Err(err) => {
                let _ = on_data_clone.send(format!("\u{0}ERROR:wait failed: {err}"));
                if let (Some(root), Ok(now_ms)) = (root_dir.as_ref(), current_time_ms()) {
                    let _ = append_run_record(
                        root,
                        &UnifiedRunRecord {
                            run_id: run_id.clone(),
                            engine_id: engine_id.clone(),
                            task_id: task_id.clone(),
                            source: "chat_execute_cli".to_string(),
                            mode: "cli".to_string(),
                            status: "error".to_string(),
                            command: profile_command.clone(),
                            cwd: cwd.clone(),
                            model: profile_model.clone(),
                            created_at: now_ms,
                            updated_at: now_ms,
                            output_preview: err.to_string().chars().take(300).collect(),
                            verification: verification.clone(),
                        },
                    );
                }
            }
        }

        entries
            .lock()
            .expect("headless process lock poisoned")
            .remove(&exec_id);
    });

    Ok(ChatExecuteCliResult {
        exec_id,
        run_id: run_id_for_return,
        pid,
        engine_id: request.engine_id,
        profile_id: profile.id,
    })
}

#[command]
pub fn chat_execute_cli_stop(
    request: ChatExecuteStopRequest,
    headless_state: State<'_, HeadlessProcessState>,
) -> Result<(), String> {
    headless_state.cancel(request.exec_id)
}

#[command]
pub async fn chat_spawn(
    request: ChatSpawnRequest,
    runtime_state: State<'_, EngineRuntimeState>,
    config_state: State<'_, AppConfigState>,
    pty_state: State<'_, PtyManagerState>,
    on_data: Channel<String>,
) -> Result<ChatSessionMeta, String> {
    let cfg = config_state.get();
    let engine = cfg
        .engines
        .get(&request.engine_id)
        .ok_or_else(|| format!("engine not found: {}", request.engine_id))?
        .clone();
    let profile = if let Some(profile_id) = request.profile_id.as_deref() {
        engine
            .profiles
            .get(profile_id)
            .cloned()
            .ok_or_else(|| format!("profile not found for engine {}: {profile_id}", request.engine_id))?
    } else {
        engine.active_profile()
    };

    *runtime_state
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

    let spawn: PtySessionInfo = pty_state.spawn_session(
        profile.command.clone(),
        with_model_args(profile.args.clone(), &request.engine_id, &profile.model),
        if cfg.project.path.trim().is_empty() {
            None
        } else {
            Some(cfg.project.path.clone())
        },
        profile.env.clone().into_iter().collect(),
        request.cols.unwrap_or(120).clamp(60, 240),
        request.rows.unwrap_or(36).clamp(20, 80),
        bridge,
    )?;

    if let Some(ready_signal) = profile.ready_signal.as_deref() {
        if !ready_signal.trim().is_empty() {
            let deadline = Instant::now() + Duration::from_millis(10_000);
            while Instant::now() < deadline {
                let snap = output_buf.lock().expect("chat output lock poisoned").clone();
                if completion_matched(Some(ready_signal), &snap) {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        }
    }

    Ok(ChatSessionMeta {
        session_id: spawn.session_id,
        engine_id: request.engine_id,
        profile_id: profile.id,
        ready_signal: profile.ready_signal,
    })
}

#[command]
pub fn chat_send(
    request: ChatSendRequest,
    pty_state: State<'_, PtyManagerState>,
) -> Result<(), String> {
    let payload = if request.append_newline.unwrap_or(true) {
        format!("{}\n", request.content)
    } else {
        request.content
    };
    pty_state.write_to_session(Some(request.session_id), &payload)
}

#[command]
pub fn chat_stop(
    request: ChatStopRequest,
    pty_state: State<'_, PtyManagerState>,
) -> Result<(), String> {
    pty_state.kill_session(request.session_id)
}
