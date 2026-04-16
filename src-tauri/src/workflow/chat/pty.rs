use crate::agent_state::AppEventHandle;
use crate::core::error::CoreError;
use crate::pty::{PtySessionInfo, PtyManagerState};
use super::super::types::{ChatSpawnRequest, ChatSessionMeta};
use super::super::util::with_model_args;
use super::super::util::completion_matched;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub fn chat_spawn_core(
    event_handle: Arc<dyn AppEventHandle>,
    request: ChatSpawnRequest,
    cfg: &crate::config::AppConfig,
    pty_state: &PtyManagerState,
    on_data: Box<dyn Fn(String) + Send + Sync>,
) -> Result<ChatSessionMeta, CoreError> {
    let prepared = crate::storage::execution_binding::resolve_execution(
        event_handle.clone(),
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
    let bridge = Box::new(move |text: String| {
        {
            let mut buf = output_buf_ch.lock().unwrap_or_else(|e| e.into_inner());
            buf.push_str(&text);
            if buf.len() > 1_000_000 {
                let drop_prefix = buf.len() - 1_000_000;
                buf.drain(..drop_prefix);
            }
        }
        on_data(text);
    });

    let session_id = uuid::Uuid::new_v4().to_string();

    let spawn: PtySessionInfo = pty_state
        .spawn_session(
            crate::pty::PtySpawnOptions {
                session_id,
                task_id: request.task_id.clone(),
                file: exec.command.clone(),
                args: with_model_args(
                    exec.args.clone(),
                    &resolved.engine_id,
                    &exec.model.clone().unwrap_or_default(),
                ),
                cwd: if cfg.project.path.trim().is_empty() {
                    None
                } else {
                    Some(cfg.project.path.clone())
                },
                env: exec.env.clone().into_iter().collect(),
                cols: request.cols.unwrap_or(120).clamp(60, 240),
                rows: request.rows.unwrap_or(36).clamp(20, 80),
            },
            bridge,
        )
        .map_err(|e| CoreError::ExecutionFailed {
            id: "chat_spawn".to_string(),
            reason: e,
        })?;

    if let Some(ready_signal) = exec.ready_signal.as_deref() {
        if !ready_signal.trim().is_empty() {
            let deadline = Instant::now() + Duration::from_millis(10_000);
            while Instant::now() < deadline {
                let snap = output_buf.lock().unwrap_or_else(|e| e.into_inner()).clone();
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
