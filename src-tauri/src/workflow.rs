use crate::config::AppConfigState;
use crate::engine::EngineRuntimeState;
use crate::pty::{PtyManagerState, PtySessionInfo};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{
    command,
    ipc::{Channel, InvokeResponseBody},
    AppHandle, Emitter, Manager, State,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowRunRequest {
    pub name: String,
    pub steps: Vec<WorkflowRunStep>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowRunStep {
    pub engine: String,
    pub profile_id: Option<String>,
    pub prompt: String,
    pub completion_signal: Option<String>,
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WorkflowProgressEvent {
    pub workflow_name: String,
    pub step_index: usize,
    pub total_steps: usize,
    pub engine: String,
    pub status: String,
    pub message: String,
    pub token_estimate: Option<TokenEstimate>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WorkflowStepResult {
    pub engine: String,
    pub mode: String,
    pub fallback: bool,
    pub success: bool,
    pub completion_matched: bool,
    pub failure_reason: Option<String>,
    pub duration_ms: u128,
    pub output: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct WorkflowRunResult {
    pub workflow_name: String,
    pub used_fallback: bool,
    pub completed: bool,
    pub archive_path: String,
    pub step_results: Vec<WorkflowStepResult>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TokenEstimate {
    pub input_chars: usize,
    pub output_chars: usize,
    pub approx_input_tokens: usize,
    pub approx_output_tokens: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepRunRequest {
    pub workflow_name: String,
    pub step: WorkflowRunStep,
    pub step_index: usize,
    pub total_steps: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct StepRunResult {
    pub engine: String,
    pub mode: String,
    pub fallback: bool,
    pub success: bool,
    pub completion_matched: bool,
    pub failure_reason: Option<String>,
    pub duration_ms: u128,
    pub output: String,
    pub token_estimate: TokenEstimate,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowArchiveEntry {
    pub name: String,
    pub path: String,
    pub modified_ts: u64,
    pub completed: bool,
    pub workflow_name: String,
    pub failed_count: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct WorkflowArchiveFailedStep {
    pub index: usize,
    pub engine: String,
    pub mode: String,
    pub status: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct WorkflowArchiveExportResult {
    pub path: String,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct WorkflowArchiveDetail {
    pub name: String,
    pub path: String,
    pub modified_ts: u64,
    pub workflow_name: String,
    pub completed: bool,
    pub used_fallback: bool,
    pub step_count: usize,
    pub failed_count: usize,
    pub failed_steps: Vec<WorkflowArchiveFailedStep>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineHistoryEntry {
    pub id: String,
    pub engine_id: String,
    pub profile_id: String,
    pub workflow_name: String,
    pub step_index: usize,
    pub mode: String,
    pub success: bool,
    pub completion_matched: bool,
    pub failure_reason: Option<String>,
    pub duration_ms: u128,
    pub summary: String,
    pub created_ts: u64,
    pub detail_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineHistoryDetail {
    pub id: String,
    pub engine_id: String,
    pub profile_id: String,
    pub workflow_name: String,
    pub step_index: usize,
    pub mode: String,
    pub created_ts: u64,
    pub prompt: String,
    pub output: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct EngineHistoryPage {
    pub entries: Vec<EngineHistoryEntry>,
    pub total: usize,
    pub page: usize,
    pub page_size: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatSpawnRequest {
    pub engine_id: String,
    pub profile_id: Option<String>,
    pub cols: Option<u16>,
    pub rows: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatSendRequest {
    pub session_id: u32,
    pub content: String,
    pub append_newline: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatStopRequest {
    pub session_id: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct ChatSessionMeta {
    pub session_id: u32,
    pub engine_id: String,
    pub profile_id: String,
    pub ready_signal: Option<String>,
}

fn sanitize_file_stem(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            out.push(ch);
        } else if ch.is_whitespace() {
            out.push('_');
        }
    }
    if out.is_empty() {
        "workflow".to_string()
    } else {
        out
    }
}

fn summarize_output(text: &str, max_chars: usize) -> String {
    let trimmed = strip_ansi_escapes::strip_str(text);
    if trimmed.chars().count() <= max_chars {
        return trimmed;
    }
    let mut out = String::new();
    for ch in trimmed.chars().take(max_chars) {
        out.push(ch);
    }
    out.push_str("...(truncated)");
    out
}

fn completion_matched(signal: Option<&str>, output: &str) -> bool {
    let Some(sig) = signal.map(str::trim).filter(|s| !s.is_empty()) else {
        return true;
    };
    let normalized = strip_ansi_escapes::strip_str(output);
    if let Ok(re) = Regex::new(sig) {
        re.is_match(&normalized)
    } else {
        normalized.contains(sig)
    }
}

fn has_model_flag(args: &[String]) -> bool {
    args.iter().any(|arg| {
        let trimmed = arg.trim();
        trimmed == "--model"
            || trimmed == "-m"
            || trimmed.starts_with("--model=")
            || trimmed.starts_with("-m=")
    })
}

fn model_flag_for_engine(engine_id: &str) -> &'static str {
    match engine_id {
        // Keep one place for per-CLI model-flag conventions.
        "claude" => "--model",
        "cursor" => "--model",
        "gemini" => "--model",
        "codex" => "--model",
        "opencode" => "--model",
        _ => "--model",
    }
}

fn with_model_args(mut args: Vec<String>, engine_id: &str, model: &str) -> Vec<String> {
    let model = model.trim();
    if model.is_empty() || has_model_flag(&args) {
        return args;
    }
    args.push(model_flag_for_engine(engine_id).to_string());
    args.push(model.to_string());
    args
}

fn estimate_token_count(chars: usize) -> usize {
    chars.div_ceil(4)
}

fn estimate_tokens(prompt: &str, output: &str) -> TokenEstimate {
    let input_chars = prompt.chars().count();
    let output_chars = output.chars().count();
    TokenEstimate {
        input_chars,
        output_chars,
        approx_input_tokens: estimate_token_count(input_chars),
        approx_output_tokens: estimate_token_count(output_chars),
    }
}

async fn execute_workflow_step(
    app: &AppHandle,
    workflow_name: &str,
    step: &WorkflowRunStep,
    step_index: usize,
    total_steps: usize,
    runtime_state: &State<'_, EngineRuntimeState>,
    config_state: &State<'_, AppConfigState>,
    pty_state: &State<'_, PtyManagerState>,
) -> Result<(WorkflowStepResult, String), String> {
    let step_started = Instant::now();
    let cfg = config_state.get();
    let engine = cfg
        .engines
        .get(&step.engine)
        .ok_or_else(|| format!("engine not found: {}", step.engine))?
        .clone();
    let profile = if let Some(profile_id) = step.profile_id.as_deref() {
        engine
            .profiles
            .get(profile_id)
            .cloned()
            .ok_or_else(|| format!("profile not found for engine {}: {profile_id}", step.engine))?
    } else {
        engine.active_profile()
    };
    *runtime_state
        .active_engine_id
        .lock()
        .expect("active_engine lock poisoned") = Some(step.engine.clone());

    app.emit(
        "workflow://progress",
        WorkflowProgressEvent {
            workflow_name: workflow_name.to_string(),
            step_index,
            total_steps,
            engine: step.engine.clone(),
            status: "starting".to_string(),
            message: "starting step".to_string(),
            token_estimate: None,
        },
    )
    .map_err(|e| format!("emit workflow progress failed: {e}"))?;

    let _mode_hint = if profile.supports_headless {
        "headless"
    } else {
        "pty-fallback"
    };
    app.emit(
        "workflow://progress",
        WorkflowProgressEvent {
            workflow_name: workflow_name.to_string(),
            step_index,
            total_steps,
            engine: step.engine.clone(),
            status: "running".to_string(),
            message: format!("starting step {} with {}", step_index + 1, step.engine),
            token_estimate: None,
        },
    )
    .map_err(|e| format!("emit workflow progress failed: {e}"))?;

    let result = if profile.supports_headless {
        let mut args = if profile.headless_args.is_empty() {
            profile.args.clone()
        } else {
            profile.headless_args.clone()
        };
        args = with_model_args(args, &step.engine, &profile.model);
        args.push(step.prompt.clone());
        
        let mut command = tokio::process::Command::new(&profile.command);
        command.args(args);
        command.stdout(Stdio::piped()).stderr(Stdio::piped());
        if !cfg.project.path.trim().is_empty() {
            command.current_dir(&cfg.project.path);
        }
        for (k, v) in &profile.env {
            command.env(k, v);
        }

        match command.spawn() {
            Ok(mut child) => {
                let timeout = step.timeout_ms.unwrap_or(30_000).max(20_000);
                let deadline = Instant::now() + Duration::from_millis(timeout);
                let mut timed_out = false;
                
                let status = loop {
                    match child.try_wait() {
                        Ok(Some(status)) => break Some(status),
                        Ok(None) => {
                            if Instant::now() >= deadline {
                                timed_out = true;
                                let _ = child.start_kill();
                                break None;
                            }
                            tokio::time::sleep(Duration::from_millis(80)).await;
                        }
                        Err(_) => break None,
                    }
                };

                let output = child.wait_with_output().await.map_err(|e| format!("wait child failed: {e}"))?;
                let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                
                let message = if stderr.trim().is_empty() {
                    stdout
                } else if stdout.trim().is_empty() {
                    stderr
                } else {
                    format!("{stdout}\n{stderr}")
                };
                
                let exited_ok = status.map(|s| s.success()).unwrap_or(false) || output.status.success();
                let matched = completion_matched(step.completion_signal.as_deref(), &message);
                let success = exited_ok && !timed_out;
                
                WorkflowStepResult {
                    engine: step.engine.clone(),
                    mode: "headless".to_string(),
                    fallback: false,
                    success,
                    completion_matched: matched,
                    failure_reason: if timed_out {
                        Some("timeout".to_string())
                    } else if !exited_ok {
                        Some("exit-nonzero".to_string())
                    } else if !matched {
                        Some("not-matched".to_string())
                    } else {
                        None
                    },
                    duration_ms: step_started.elapsed().as_millis(),
                    output: message,
                }
            }
            Err(e) => WorkflowStepResult {
                engine: step.engine.clone(),
                mode: "headless".to_string(),
                fallback: false,
                success: false,
                completion_matched: false,
                failure_reason: Some("spawn-failed".to_string()),
                duration_ms: step_started.elapsed().as_millis(),
                output: format!("failed to run headless command: {e}"),
            },
        }
    } else {
        let output_buf = Arc::new(Mutex::new(String::new()));
        let output_buf_ch = Arc::clone(&output_buf);
        let on_data = Channel::new(move |chunk: InvokeResponseBody| {
            let text = match chunk {
                InvokeResponseBody::Json(s) => s,
                InvokeResponseBody::Raw(bytes) => String::from_utf8_lossy(&bytes).to_string(),
            };
            let mut buf = output_buf_ch.lock().expect("workflow output lock poisoned");
            buf.push_str(&text);
            if buf.len() > 1_000_000 {
                let drop_prefix = buf.len() - 1_000_000;
                buf.drain(..drop_prefix);
            }
            Ok(())
        });

        let spawn = pty_state.spawn_session(
            profile.command.clone(),
            with_model_args(profile.args.clone(), &step.engine, &profile.model),
            if cfg.project.path.trim().is_empty() {
                None
            } else {
                Some(cfg.project.path.clone())
            },
            profile.env.clone().into_iter().collect(),
            120,
            36,
            on_data,
        )?;

        if let Some(ready_signal) = profile.ready_signal.as_deref() {
            let ready_deadline =
                Instant::now() + Duration::from_millis(step.timeout_ms.unwrap_or(15_000) / 3);
            while Instant::now() < ready_deadline {
                let snap = output_buf
                    .lock()
                    .expect("workflow output lock poisoned")
                    .clone();
                if completion_matched(Some(ready_signal), &snap) {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(80)).await;
            }
        }

        pty_state.write_to_session(Some(spawn.session_id), &format!("{}\n", step.prompt))?;

        let timeout = step.timeout_ms.unwrap_or(30_000).max(500);
        let deadline = Instant::now() + Duration::from_millis(timeout);
        let mut matched = false;
        let mut timed_out = false;
        while Instant::now() < deadline {
            let snap = output_buf
                .lock()
                .expect("workflow output lock poisoned")
                .clone();
            if completion_matched(step.completion_signal.as_deref(), &snap) {
                matched = true;
                break;
            }
            if pty_state.try_wait_exit_status(spawn.session_id).is_some() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(120)).await;
        }
        if !matched && Instant::now() >= deadline {
            timed_out = true;
        }

        let _ = pty_state.kill_session(spawn.session_id);
        let final_output = output_buf
            .lock()
            .expect("workflow output lock poisoned")
            .clone();

        WorkflowStepResult {
            engine: step.engine.clone(),
            mode: "pty-fallback".to_string(),
            fallback: true,
            success: matched,
            completion_matched: matched,
            failure_reason: if matched {
                None
            } else if timed_out {
                Some("timeout".to_string())
            } else {
                Some("not-matched".to_string())
            },
            duration_ms: step_started.elapsed().as_millis(),
            output: final_output,
        }
    };

    let token_estimate = estimate_tokens(&step.prompt, &result.output);
    app.emit(
        "workflow://progress",
        WorkflowProgressEvent {
            workflow_name: workflow_name.to_string(),
            step_index,
            total_steps,
            engine: step.engine.clone(),
            status: "done".to_string(),
            message: if result.success && result.completion_matched {
                "step completed".to_string()
            } else if result.success {
                "step done but completion signal not matched".to_string()
            } else {
                "step failed".to_string()
            },
            token_estimate: Some(token_estimate),
        },
    )
    .map_err(|e| format!("emit workflow progress failed: {e}"))?;

    Ok((result, profile.id))
}

fn save_archive(
    app: &AppHandle,
    request: &WorkflowRunRequest,
    result: &WorkflowRunResult,
) -> Result<String, String> {
    #[derive(Serialize)]
    struct ArchivePayload<'a> {
        request: &'a WorkflowRunRequest,
        result: &'a WorkflowRunResult,
    }

    let dir = archive_dir(app)?;

    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("system time error: {e}"))?
        .as_secs();
    let stem = sanitize_file_stem(&request.name);
    let path = dir.join(format!("{stem}-{ts}.json"));
    let payload = ArchivePayload { request, result };
    let text = serde_json::to_string_pretty(&payload)
        .map_err(|e| format!("serialize archive payload failed: {e}"))?;
    fs::write(&path, text).map_err(|e| format!("write archive file failed: {e}"))?;
    Ok(path.display().to_string())
}

fn archive_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let mut dir: PathBuf = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("resolve app config dir failed: {e}"))?;
    dir.push("workflow-archives");
    fs::create_dir_all(&dir).map_err(|e| format!("create archive dir failed: {e}"))?;
    Ok(dir)
}

fn history_root_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let mut dir: PathBuf = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("resolve app config dir failed: {e}"))?;
    dir.push("engine-history");
    fs::create_dir_all(&dir).map_err(|e| format!("create history dir failed: {e}"))?;
    Ok(dir)
}

fn history_index_dir(app: &AppHandle, engine_id: &str) -> Result<PathBuf, String> {
    let mut dir = history_root_dir(app)?;
    dir.push("index");
    dir.push(sanitize_file_stem(engine_id));
    fs::create_dir_all(&dir).map_err(|e| format!("create history index dir failed: {e}"))?;
    Ok(dir)
}

fn history_detail_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let mut dir = history_root_dir(app)?;
    dir.push("details");
    fs::create_dir_all(&dir).map_err(|e| format!("create history detail dir failed: {e}"))?;
    Ok(dir)
}

fn resolve_history_detail_path(app: &AppHandle, detail_path: &str) -> Result<PathBuf, String> {
    let base = history_root_dir(app)?
        .canonicalize()
        .map_err(|e| format!("canonicalize history root failed: {e}"))?;
    let requested = PathBuf::from(detail_path);
    let canonical = requested
        .canonicalize()
        .map_err(|e| format!("canonicalize history detail failed: {e}"))?;
    if !canonical.starts_with(&base) {
        return Err("history detail path is outside engine-history".to_string());
    }
    Ok(canonical)
}

fn last_conversation_path(app: &AppHandle) -> Result<PathBuf, String> {
    let mut dir: PathBuf = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("resolve app config dir failed: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("create app config dir failed: {e}"))?;
    dir.push("last-conversation.json");
    Ok(dir)
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

fn persist_engine_history(
    app: &AppHandle,
    engine_id: &str,
    profile_id: &str,
    workflow_name: &str,
    step_index: usize,
    prompt: &str,
    step: &WorkflowStepResult,
) -> Result<(), String> {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("system time error: {e}"))?
        .as_secs();
    let unique_ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("system time error: {e}"))?
        .as_nanos();
    let id = format!(
        "{}-{}-{}",
        unique_ts,
        sanitize_file_stem(workflow_name),
        sanitize_file_stem(&format!("{engine_id}-{step_index}"))
    );

    let mut detail_path = history_detail_dir(app)?;
    detail_path.push(format!("{id}.json"));
    let detail = EngineHistoryDetail {
        id: id.clone(),
        engine_id: engine_id.to_string(),
        profile_id: profile_id.to_string(),
        workflow_name: workflow_name.to_string(),
        step_index,
        mode: step.mode.clone(),
        created_ts: ts,
        prompt: prompt.to_string(),
        output: step.output.clone(),
    };
    let detail_text =
        serde_json::to_string_pretty(&detail).map_err(|e| format!("serialize history detail failed: {e}"))?;
    fs::write(&detail_path, detail_text).map_err(|e| format!("write history detail failed: {e}"))?;

    let mut entry_path = history_index_dir(app, engine_id)?;
    entry_path.push(format!("{id}.json"));
    let entry = EngineHistoryEntry {
        id,
        engine_id: engine_id.to_string(),
        profile_id: profile_id.to_string(),
        workflow_name: workflow_name.to_string(),
        step_index,
        mode: step.mode.clone(),
        success: step.success,
        completion_matched: step.completion_matched,
        failure_reason: step.failure_reason.clone(),
        duration_ms: step.duration_ms,
        summary: summarize_output(&step.output, 280),
        created_ts: ts,
        detail_path: detail_path.display().to_string(),
    };
    let entry_text =
        serde_json::to_string_pretty(&entry).map_err(|e| format!("serialize history entry failed: {e}"))?;
    fs::write(&entry_path, entry_text).map_err(|e| format!("write history entry failed: {e}"))?;
    Ok(())
}

fn resolve_archive_path(app: &AppHandle, archive_path: &str) -> Result<PathBuf, String> {
    let base = archive_dir(app)?
        .canonicalize()
        .map_err(|e| format!("canonicalize archive dir failed: {e}"))?;
    let requested = PathBuf::from(archive_path);
    let canonical = requested
        .canonicalize()
        .map_err(|e| format!("canonicalize archive path failed: {e}"))?;
    if !canonical.starts_with(&base) {
        return Err("archive path is outside workflow-archives".to_string());
    }
    Ok(canonical)
}

#[command]
pub async fn workflow_list_archives(app: AppHandle) -> Result<Vec<WorkflowArchiveEntry>, String> {
    let dir = archive_dir(&app)?;
    let mut read_dir = tokio::fs::read_dir(&dir).await.map_err(|e| format!("read archive dir failed: {e}"))?;
    let mut tasks = Vec::new();

    while let Some(item) = read_dir.next_entry().await.map_err(|e| format!("read archive item failed: {e}"))? {
        let path = item.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        
        tasks.push(tokio::spawn(async move {
            let metadata = tokio::fs::metadata(&path).await.ok()?;
            let modified_ts = metadata.modified().ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            
            let json_data = tokio::fs::read_to_string(&path).await.ok()
                .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok());
            
            let (completed, workflow_name, failed_count) = if let Some(json) = json_data {
                let res = json.get("result");
                let completed = res.and_then(|r| r.get("completed")).and_then(|c| c.as_bool()).unwrap_or(false);
                let name = res.and_then(|r| r.get("workflow_name")).and_then(|n| n.as_str())
                    .or_else(|| json.get("request").and_then(|r| r.get("name")).and_then(|n| n.as_str()))
                    .unwrap_or_default()
                    .to_string();
                let fc = res.and_then(|r| r.get("step_results")).and_then(|x| x.as_array())
                    .map(|arr| {
                        arr.iter().filter(|step| {
                            let ok = step.get("success").and_then(|x| x.as_bool()).unwrap_or(false);
                            let matched = step.get("completion_matched").and_then(|x| x.as_bool()).unwrap_or(false);
                            !(ok && matched)
                        }).count()
                    }).unwrap_or(0);
                (completed, name, fc)
            } else {
                (false, String::new(), 0)
            };

            Some(WorkflowArchiveEntry {
                name: path.file_name().and_then(|s| s.to_str()).unwrap_or_default().to_string(),
                path: path.display().to_string(),
                modified_ts,
                completed,
                workflow_name,
                failed_count,
            })
        }));
    }

    let results = futures::future::join_all(tasks).await;
    let mut entries: Vec<WorkflowArchiveEntry> = results.into_iter()
        .filter_map(|r: Result<Option<WorkflowArchiveEntry>, tokio::task::JoinError>| r.ok().flatten())
        .collect();
        
    entries.sort_by(|a, b| b.modified_ts.cmp(&a.modified_ts));
    Ok(entries)
}

#[command]
pub async fn workflow_get_archive(
    app: AppHandle,
    archive_path: String,
) -> Result<WorkflowArchiveDetail, String> {
    let canonical = resolve_archive_path(&app, &archive_path)?;
    let text = tokio::fs::read_to_string(&canonical).await.map_err(|e| format!("read archive failed: {e}"))?;
    let v: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("parse archive json failed: {e}"))?;
    let result = v
        .get("result")
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));
    let step_count = result
        .get("step_results")
        .and_then(|x| x.as_array())
        .map(|arr| arr.len())
        .unwrap_or(0);
    let failed_count = result
        .get("step_results")
        .and_then(|x| x.as_array())
        .map(|arr| {
            arr.iter()
                .filter(|step| {
                    let success = step
                        .get("success")
                        .and_then(|x| x.as_bool())
                        .unwrap_or(false);
                    let matched = step
                        .get("completion_matched")
                        .and_then(|x| x.as_bool())
                        .unwrap_or(false);
                    !(success && matched)
                })
                .count()
        })
        .unwrap_or(0);
    let failed_steps = result
        .get("step_results")
        .and_then(|x| x.as_array())
        .map(|arr| {
            arr.iter()
                .enumerate()
                .filter_map(|(index, step)| {
                    let success = step
                        .get("success")
                        .and_then(|x| x.as_bool())
                        .unwrap_or(false);
                    let matched = step
                        .get("completion_matched")
                        .and_then(|x| x.as_bool())
                        .unwrap_or(false);
                    if success && matched {
                        return None;
                    }
                    let status = if success && !matched {
                        "not-matched".to_string()
                    } else {
                        "failed".to_string()
                    };
                    let reason = step
                        .get("failure_reason")
                        .and_then(|x| x.as_str())
                        .map(str::to_string)
                        .unwrap_or_else(|| {
                            if success && !matched {
                                "not-matched".to_string()
                            } else {
                                "failed".to_string()
                            }
                        });
                    Some(WorkflowArchiveFailedStep {
                        index,
                        engine: step
                            .get("engine")
                            .and_then(|x| x.as_str())
                            .unwrap_or_default()
                            .to_string(),
                        mode: step
                            .get("mode")
                            .and_then(|x| x.as_str())
                            .unwrap_or_default()
                            .to_string(),
                        status,
                        reason,
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let metadata = fs::metadata(&canonical).map_err(|e| format!("archive metadata failed: {e}"))?;
    let modified_ts = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);

    Ok(WorkflowArchiveDetail {
        name: canonical
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or_default()
            .to_string(),
        path: canonical.display().to_string(),
        modified_ts,
        workflow_name: result
            .get("workflow_name")
            .and_then(|x| x.as_str())
            .or_else(|| v.get("request")?.get("name")?.as_str())
            .unwrap_or_default()
            .to_string(),
        completed: result
            .get("completed")
            .and_then(|x| x.as_bool())
            .unwrap_or(false),
        used_fallback: result
            .get("used_fallback")
            .and_then(|x| x.as_bool())
            .unwrap_or(false),
        step_count,
        failed_count,
        failed_steps,
    })
}

#[command]
pub async fn workflow_get_full_archive(
    app: AppHandle,
    archive_path: String,
) -> Result<serde_json::Value, String> {
    let canonical = resolve_archive_path(&app, &archive_path)?;
    let text = fs::read_to_string(&canonical).map_err(|e| format!("read archive failed: {e}"))?;
    serde_json::from_str::<serde_json::Value>(&text)
        .map_err(|e| format!("parse archive json failed: {e}"))
}

#[command]
pub async fn workflow_export_archives(
    app: AppHandle,
    entries: Vec<WorkflowArchiveEntry>,
) -> Result<WorkflowArchiveExportResult, String> {
    let count = entries.len();
    let mut dir = archive_dir(&app)?;
    dir.push("exports");
    fs::create_dir_all(&dir).map_err(|e| format!("create export dir failed: {e}"))?;

    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("system time error: {e}"))?
        .as_secs();
    let path = dir.join(format!("archive-list-{ts}.json"));
    let payload = serde_json::json!({
        "exported_at": ts,
        "count": count,
        "entries": entries,
    });
    let text = serde_json::to_string_pretty(&payload)
        .map_err(|e| format!("serialize export payload failed: {e}"))?;
    fs::write(&path, text).map_err(|e| format!("write export file failed: {e}"))?;
    Ok(WorkflowArchiveExportResult { path: path.display().to_string(), count })
}

#[command]
pub fn workflow_list_engine_history(
    app: AppHandle,
    engine_id: Option<String>,
    page: Option<usize>,
    page_size: Option<usize>,
) -> Result<EngineHistoryPage, String> {
    let page = page.unwrap_or(1).max(1);
    let page_size = page_size.unwrap_or(20).clamp(1, 100);
    let mut entries = Vec::new();

    let mut root = history_root_dir(&app)?;
    root.push("index");
    if !root.exists() {
        return Ok(EngineHistoryPage {
            entries,
            total: 0,
            page,
            page_size,
        });
    }

    let mut engine_dirs = Vec::new();
    if let Some(id) = engine_id {
        let mut dir = root.clone();
        dir.push(sanitize_file_stem(&id));
        if dir.exists() {
            engine_dirs.push(dir);
        }
    } else {
        for item in fs::read_dir(&root).map_err(|e| format!("read history index root failed: {e}"))? {
            let item = item.map_err(|e| format!("read history engine dir failed: {e}"))?;
            if item.path().is_dir() {
                engine_dirs.push(item.path());
            }
        }
    }

    for dir in engine_dirs {
        for item in fs::read_dir(&dir).map_err(|e| format!("read history index dir failed: {e}"))? {
            let item = item.map_err(|e| format!("read history index item failed: {e}"))?;
            let path = item.path();
            if path.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            let text =
                fs::read_to_string(&path).map_err(|e| format!("read history entry failed: {e}"))?;
            let entry: EngineHistoryEntry = serde_json::from_str(&text)
                .map_err(|e| format!("parse history entry failed: {e}"))?;
            entries.push(entry);
        }
    }

    entries.sort_by(|a, b| b.created_ts.cmp(&a.created_ts));
    let total = entries.len();
    let start = (page - 1) * page_size;
    let paged = if start >= total {
        Vec::new()
    } else {
        entries
            .into_iter()
            .skip(start)
            .take(page_size)
            .collect::<Vec<_>>()
    };
    Ok(EngineHistoryPage {
        entries: paged,
        total,
        page,
        page_size,
    })
}

#[command]
pub fn workflow_get_engine_history_detail(
    app: AppHandle,
    detail_path: String,
) -> Result<EngineHistoryDetail, String> {
    let canonical = resolve_history_detail_path(&app, &detail_path)?;
    let text = fs::read_to_string(&canonical).map_err(|e| format!("read history detail failed: {e}"))?;
    serde_json::from_str::<EngineHistoryDetail>(&text)
        .map_err(|e| format!("parse history detail failed: {e}"))
}

#[command]
pub async fn workflow_run_step(
    app: AppHandle,
    request: StepRunRequest,
    runtime_state: State<'_, EngineRuntimeState>,
    config_state: State<'_, AppConfigState>,
    pty_state: State<'_, PtyManagerState>,
) -> Result<StepRunResult, String> {
    let total_steps = request.total_steps.max(1);
    let step_index = request.step_index.min(total_steps.saturating_sub(1));
    let (result, profile_id): (WorkflowStepResult, String) = execute_workflow_step(
        &app,
        &request.workflow_name,
        &request.step,
        step_index,
        total_steps,
        &runtime_state,
        &config_state,
        &pty_state,
    )
    .await?;

    if let Err(err) = persist_engine_history(
        &app,
        &request.step.engine,
        &profile_id,
        &request.workflow_name,
        step_index,
        &request.step.prompt,
        &result,
    ) {
        let _ = app.emit(
            "workflow://progress",
            WorkflowProgressEvent {
                workflow_name: request.workflow_name.clone(),
                step_index,
                total_steps,
                engine: request.step.engine.clone(),
                status: "warning".to_string(),
                message: format!("history persistence failed: {err}"),
                token_estimate: None,
            },
        );
    }

    let tokens = estimate_tokens(&request.step.prompt, &result.output);
    Ok(StepRunResult {
        engine: result.engine,
        mode: result.mode,
        fallback: result.fallback,
        success: result.success,
        completion_matched: result.completion_matched,
        failure_reason: result.failure_reason,
        duration_ms: result.duration_ms,
        output: result.output,
        token_estimate: tokens,
    })
}

#[command]
pub async fn workflow_run(
    app: AppHandle,
    request: WorkflowRunRequest,
    runtime_state: State<'_, EngineRuntimeState>,
    config_state: State<'_, AppConfigState>,
    pty_state: State<'_, PtyManagerState>,
) -> Result<WorkflowRunResult, String> {
    let workflow_name = request.name.clone();
    let total = request.steps.len();
    if total == 0 {
        return Err("workflow has no steps".to_string());
    }
    let mut used_fallback = false;
    let mut step_results = Vec::with_capacity(total);

    for (idx, step) in request.steps.iter().enumerate() {
        let (result, profile_id): (WorkflowStepResult, String) = execute_workflow_step(
            &app,
            &workflow_name,
            step,
            idx,
            total,
            &runtime_state,
            &config_state,
            &pty_state,
        )
        .await?;
        used_fallback = used_fallback || result.fallback;

        if let Err(err) = persist_engine_history(
            &app,
            &step.engine,
            &profile_id,
            &workflow_name,
            idx,
            &step.prompt,
            &result,
        ) {
            let _ = app.emit(
                "workflow://progress",
                WorkflowProgressEvent {
                    workflow_name: workflow_name.clone(),
                    step_index: idx,
                    total_steps: total,
                    engine: step.engine.clone(),
                    status: "warning".to_string(),
                    message: format!("history persistence failed: {err}"),
                    token_estimate: None,
                },
            );
        }

        step_results.push(result);
    }

    app.emit(
        "workflow://progress",
        WorkflowProgressEvent {
            workflow_name: workflow_name.clone(),
            step_index: total,
            total_steps: total,
            engine: runtime_state
                .active_engine_id
                .lock()
                .expect("active_engine lock poisoned")
                .clone()
                .unwrap_or_default(),
            status: "finished".to_string(),
            message: "workflow completed".to_string(),
            token_estimate: None,
        },
    )
    .map_err(|e| format!("emit workflow progress failed: {e}"))?;

    let completed = step_results
        .iter()
        .all(|s| s.success && s.completion_matched);
    let mut run_result = WorkflowRunResult {
        workflow_name,
        used_fallback,
        completed,
        archive_path: String::new(),
        step_results,
    };

    run_result.archive_path = save_archive(&app, &request, &run_result)?;
    Ok(run_result)
}
