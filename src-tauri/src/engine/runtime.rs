//! Session cleanup for task-engine switch.
//! Provides low-level capability: kill/exit a CLI session. Does not know about tasks.
//! The task_switch_engine use case in core orchestrates this + DB update + event.

use crate::config::AppConfig;
use crate::pty::{resolve_exit_payload, wait_exit_status, PtyManagerState};
use serde::Serialize;
use std::thread;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize)]
pub struct EngineSwitchResult {
    pub active_engine_id: String,
    pub previous_session_killed: bool,
}

/// Clean up old CLI session when switching task's engine.
pub fn cleanup_session_for_task_engine_switch(
    engine_id: String,
    session_id: Option<String>,
    config: AppConfig,
    pty_state: &PtyManagerState,
) -> Result<EngineSwitchResult, String> {
    let engine = config
        .engines
        .get(&engine_id)
        .ok_or_else(|| format!("engine not found: {engine_id}"))?;

    let mut killed = false;
    if let Some(id) = session_id {
        let payload = resolve_exit_payload(&engine.exit_command());
        let _ = pty_state.write_to_session(&id, &payload);
        let start = Instant::now();
        while start.elapsed() < Duration::from_millis(engine.exit_timeout_ms()) {
            if wait_exit_status(pty_state, &id).is_some() {
                let _ = pty_state.kill_session(&id);
                killed = true;
                break;
            }
            thread::sleep(Duration::from_millis(100));
        }
        if !killed {
            let _ = pty_state.kill_session(&id);
            killed = true;
        }
    }

    Ok(EngineSwitchResult {
        active_engine_id: engine_id,
        previous_session_killed: killed,
    })
}
