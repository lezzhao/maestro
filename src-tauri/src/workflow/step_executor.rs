use super::types::*;
use super::util::*;
use super::verification_parser::extract_verification_summary;
use crate::agent_state::emitter::AppEventHandle;
use crate::core::error::CoreError;
use crate::core::events::EventStream;
use crate::pty::PtyManagerState;
use crate::storage::execution_binding::resolve_execution;
use std::collections::VecDeque;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Maximum PTY output buffer size (1 MB).
const MAX_PTY_OUTPUT_BYTES: usize = 1_000_000;

/// Ring buffer for PTY output that avoids expensive `drain()` on large buffers.
struct OutputRingBuffer {
    buf: VecDeque<u8>,
    max_bytes: usize,
}

impl OutputRingBuffer {
    fn new(max_bytes: usize) -> Self {
        Self {
            buf: VecDeque::with_capacity(max_bytes.min(64 * 1024)),
            max_bytes,
        }
    }

    fn push_str(&mut self, s: &str) {
        let bytes = s.as_bytes();
        if bytes.len() >= self.max_bytes {
            self.buf.clear();
            let start = bytes.len() - self.max_bytes;
            self.buf.extend(&bytes[start..]);
            return;
        }
        
        let needed = self.buf.len() + bytes.len();
        if needed > self.max_bytes {
            let to_drop = needed - self.max_bytes;
            drop(self.buf.drain(..to_drop));
        }
        self.buf.extend(bytes);
    }

    fn to_string_lossy(&self) -> String {
        let contiguous: Vec<u8> = self.buf.iter().copied().collect();
        String::from_utf8_lossy(&contiguous).into_owned()
    }
}

pub(crate) async fn execute_workflow_step(
    event_handle: Arc<dyn AppEventHandle>,
    emitter: Arc<dyn EventStream>,
    workflow_name: &str,
    step: &WorkflowRunStep,
    step_index: usize,
    total_steps: usize,
    state_token: Option<String>,
    cfg: &crate::config::AppConfig,
    pty_state: &PtyManagerState,
) -> Result<(WorkflowStepResult, String), CoreError> {
    let step_started = Instant::now();
    let prepared = resolve_execution(
        event_handle,
        &step.engine,
        step.profile_id.as_deref(),
        "workflow",
        None,
        "workflow",
        cfg,
    )?;
    let resolved = prepared.context;

    let i18n = cfg.i18n();
    emit_progress(
        &emitter,
        workflow_name,
        step_index,
        total_steps,
        &step.engine,
        "starting",
        &i18n.t("workflow_starting_step"),
        None,
        state_token.clone(),
    )?;

    let _mode_hint = if resolved.supports_headless {
        "headless"
    } else {
        "pty-fallback"
    };
    emit_progress(
        &emitter,
        workflow_name,
        step_index,
        total_steps,
        &step.engine,
        "running",
        &i18n
            .t("workflow_running_step")
            .replace("{}", &(step_index + 1).to_string())
            .replace("{}", &step.engine),
        None,
        state_token.clone(),
    )?;

    let result = if resolved.supports_headless {
        execute_headless(step, &resolved, cfg, step_started, &i18n).await?
    } else {
        execute_pty_fallback(step, &resolved, cfg, pty_state, step_started, &i18n).await?
    };

    let done_message = if result.success && result.completion_matched {
        i18n.t("workflow_step_completed")
    } else if result.success {
        i18n.t("workflow_step_not_matched")
    } else {
        i18n.t("workflow_step_failed")
    };
    emit_progress(
        &emitter,
        workflow_name,
        step_index,
        total_steps,
        &step.engine,
        "done",
        &done_message,
        Some(result.token_estimate.clone()),
        state_token,
    )?;

    Ok((
        result,
        resolved
            .profile_id
            .unwrap_or_else(|| "default".to_string()),
    ))
}

// ── Headless execution ──────────────────────────────────────────────

async fn execute_headless(
    step: &WorkflowRunStep,
    resolved: &crate::task::runtime::ResolvedRuntimeContext,
    cfg: &crate::config::AppConfig,
    step_started: Instant,
    i18n: &crate::i18n::I18n,
) -> Result<WorkflowStepResult, CoreError> {
    let mut args = if resolved.headless_args.is_empty() {
        resolved.args.clone()
    } else {
        resolved.headless_args.clone()
    };
    args = with_model_args(
        args,
        &step.engine,
        &resolved.model.clone().unwrap_or_default(),
    );
    args.push(step.prompt.clone());

    let full_command_str = format!("{} {}", resolved.command, args.join(" "));
    if let Err(reason) = crate::plugin_engine::action_guard::ActionGuard::unwrap_default()
        .check_command(&full_command_str)
    {
        return Ok(WorkflowStepResult {
            engine: step.engine.clone(),
            mode: "headless".to_string(),
            status: "error".to_string(),
            fallback: false,
            success: false,
            completion_matched: false,
            failure_reason: Some("action-guard".to_string()),
            duration_ms: step_started.elapsed().as_millis(),
            output: format!("Blocked by ActionGuard: {reason}"),
            token_estimate: estimate_tokens(&step.prompt, &format!("Blocked by ActionGuard: {reason}")),
            verification: None,
        });
    }

    let mut command = tokio::process::Command::new(&resolved.command);
    #[cfg(unix)]
    {
        command.process_group(0);
    }
    command.args(args.clone());
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    if !cfg.project.path.trim().is_empty() {
        command.current_dir(&cfg.project.path);
    }
    for (k, v) in &resolved.env {
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

            let output =
                child
                    .wait_with_output()
                    .await
                    .map_err(|e| CoreError::ExecutionFailed {
                        id: step.engine.clone(),
                        reason: format!("wait child failed: {e}"),
                    })?;
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();

            let message = if stderr.trim().is_empty() {
                stdout
            } else if stdout.trim().is_empty() {
                stderr
            } else {
                format!("{stdout}\n{stderr}")
            };

            let exited_ok =
                status.map(|s| s.success()).unwrap_or(false) || output.status.success();
            let matched = completion_matched(step.completion_signal.as_deref(), &message);
            let success = exited_ok && !timed_out;
            let duration_ms = step_started.elapsed().as_millis();
            let verification =
                extract_verification_summary(&message, success && matched, duration_ms, i18n);

            Ok(WorkflowStepResult {
                engine: step.engine.clone(),
                mode: "headless".to_string(),
                status: if success && matched {
                    "done".to_string()
                } else {
                    "error".to_string()
                },
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
                duration_ms,
                output: message.clone(),
                token_estimate: estimate_tokens(&step.prompt, &message),
                verification,
            })
        }
        Err(e) => Ok(WorkflowStepResult {
            engine: step.engine.clone(),
            mode: "headless".to_string(),
            status: "error".to_string(),
            fallback: false,
            success: false,
            completion_matched: false,
            failure_reason: Some("spawn-failed".to_string()),
            duration_ms: step_started.elapsed().as_millis(),
            output: format!("failed to run headless command: {e}"),
            token_estimate: estimate_tokens(&step.prompt, &format!("failed to run headless command: {e}")),
            verification: None,
        }),
    }
}

// ── PTY fallback execution ──────────────────────────────────────────

async fn execute_pty_fallback(
    step: &WorkflowRunStep,
    resolved: &crate::task::runtime::ResolvedRuntimeContext,
    cfg: &crate::config::AppConfig,
    pty_state: &PtyManagerState,
    step_started: Instant,
    i18n: &crate::i18n::I18n,
) -> Result<WorkflowStepResult, CoreError> {
    let args_for_pty = with_model_args(
        resolved.args.clone(),
        &step.engine,
        &resolved.model.clone().unwrap_or_default(),
    );
    let full_command_str = format!(
        "{} {} {}",
        resolved.command,
        args_for_pty.join(" "),
        step.prompt
    );
    if let Err(reason) = crate::plugin_engine::action_guard::ActionGuard::unwrap_default()
        .check_command(&full_command_str)
    {
        return Ok(WorkflowStepResult {
            engine: step.engine.clone(),
            mode: "pty-fallback".to_string(),
            status: "error".to_string(),
            fallback: true,
            success: false,
            completion_matched: false,
            failure_reason: Some("action-guard".to_string()),
            duration_ms: step_started.elapsed().as_millis(),
            output: format!("Blocked by ActionGuard: {reason}"),
            token_estimate: estimate_tokens(&step.prompt, &format!("Blocked by ActionGuard: {reason}")),
            verification: None,
        });
    }

    let output_buf = Arc::new(Mutex::new(OutputRingBuffer::new(MAX_PTY_OUTPUT_BYTES)));
    let output_buf_ch = Arc::clone(&output_buf);
    let on_data = Box::new(move |text: String| {
        let mut buf = output_buf_ch.lock().unwrap_or_else(|e| e.into_inner());
        buf.push_str(&text);
    });

    let session_id = uuid::Uuid::new_v4().to_string();
    let spawn = pty_state
        .spawn_session(
            crate::pty::PtySpawnOptions {
                session_id,
                task_id: None,
                file: resolved.command.clone(),
                args: args_for_pty,
                cwd: if cfg.project.path.trim().is_empty() {
                    None
                } else {
                    Some(cfg.project.path.clone())
                },
                env: resolved.env.clone().into_iter().collect(),
                cols: 120,
                rows: 36,
            },
            on_data,
        )
        .map_err(CoreError::from)?;

    if let Some(ready_signal) = resolved.ready_signal.as_deref() {
        let ready_deadline =
            Instant::now() + Duration::from_millis(step.timeout_ms.unwrap_or(15_000) / 3);
        while Instant::now() < ready_deadline {
            let snap = output_buf
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .to_string_lossy();
            if completion_matched(Some(ready_signal), &snap) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(80)).await;
        }
    }

    pty_state
        .write_to_session(&spawn.session_id, &format!("{}\n", step.prompt))
        .map_err(CoreError::from)?;

    let timeout = step.timeout_ms.unwrap_or(30_000).max(500);
    let deadline = Instant::now() + Duration::from_millis(timeout);
    let mut matched = false;
    let mut timed_out = false;
    while Instant::now() < deadline {
        let snap = output_buf
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .to_string_lossy();
        if completion_matched(step.completion_signal.as_deref(), &snap) {
            matched = true;
            break;
        }
        if pty_state
            .try_wait_exit_status(&spawn.session_id)
            .is_some()
        {
            break;
        }
        tokio::time::sleep(Duration::from_millis(120)).await;
    }
    if !matched && Instant::now() >= deadline {
        timed_out = true;
    }

    let _ = pty_state.kill_session(&spawn.session_id);
    let final_output = output_buf
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .to_string_lossy();
    let duration_ms = step_started.elapsed().as_millis();

    Ok(WorkflowStepResult {
        engine: step.engine.clone(),
        mode: "pty-fallback".to_string(),
        status: if matched {
            "done".to_string()
        } else {
            "error".to_string()
        },
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
        duration_ms,
        verification: extract_verification_summary(&final_output, matched, duration_ms, i18n),
        token_estimate: estimate_tokens(&step.prompt, &final_output),
        output: final_output,
    })
}

// ── Helper: emit progress event ─────────────────────────────────────

fn emit_progress(
    emitter: &Arc<dyn EventStream>,
    workflow_name: &str,
    step_index: usize,
    total_steps: usize,
    engine: &str,
    status: &str,
    message: &str,
    token_estimate: Option<TokenEstimate>,
    state_token: Option<String>,
) -> Result<(), CoreError> {
    emitter
        .send_event(
            "workflow://progress",
            serde_json::to_value(WorkflowProgressEvent {
                workflow_name: workflow_name.to_string(),
                step_index,
                total_steps,
                engine: engine.to_string(),
                status: status.to_string(),
                message: message.to_string(),
                token_estimate,
                state_token,
            })
            .map_err(|e| CoreError::Serialization {
                message: e.to_string(),
            })?,
        )
        .map_err(|e| CoreError::SystemError {
            message: format!("emit workflow progress failed: {e}"),
        })
}
