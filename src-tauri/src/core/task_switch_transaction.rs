//! Transaction abstraction for task engine switch.
//!
//! Enforces execution order at compile time:
//! 1. DB update (authoritative; must succeed for transaction to proceed)
//! 2. Event broadcast (frontend sync)
//! 3. Session cleanup (best-effort; failure is logged but does not rollback)
//!
//! If DB fails: no events, no cleanup — user can retry.
//! If cleanup fails after DB success: binding is already updated; orphan session can be recovered later.

use crate::agent_state::{emit_state_update, AgentStateUpdate};
use crate::config::AppConfig;
use crate::engine;
use crate::task_runtime_service::{update_task_runtime_context, UpdateTaskRuntimeContextResult};
use crate::task_state::TaskSwitchRuntimeBindingRequest;
use tauri::AppHandle;

/// Execute task switch runtime binding as an atomic transaction.
/// Steps are ordered; cleanup failure does not fail the transaction.
pub fn execute(
    app: &AppHandle,
    request: TaskSwitchRuntimeBindingRequest,
    config: &AppConfig,
    pty_state: &crate::pty::PtyManagerState,
) -> Result<(), crate::core::error::CoreError> {
    // Step 1: DB update (must succeed)
    let result = update_task_runtime_context(
        app,
        &request.task_id,
        &request.engine_id,
        request.profile_id,
        config,
    )
    .map_err(crate::core::error::CoreError::from)?;

    // Step 2: Event broadcast (frontend sync)
    emit_events(app, &request.task_id, &result);

    // Step 3: Session cleanup (best-effort; log on failure)
    if let Some(ref session_id) = request.session_id {
        run_session_cleanup(
            request.engine_id.clone(),
            Some(session_id.clone()),
            config.clone(),
            pty_state,
        );
    }

    Ok(())
}

fn emit_events(app: &AppHandle, task_id: &str, result: &UpdateTaskRuntimeContextResult) {
    emit_state_update(
        Some(app),
        AgentStateUpdate::TaskRuntimeBindingChanged {
            task_id: task_id.to_string(),
            binding: result.binding.clone(),
        },
    );
    if let Some(ref ctx) = result.resolved_context {
        emit_state_update(
            Some(app),
            AgentStateUpdate::TaskRuntimeContextResolved {
                task_id: task_id.to_string(),
                context: ctx.clone(),
            },
        );
    }
}

fn run_session_cleanup(
    engine_id: String,
    session_id: Option<String>,
    config: AppConfig,
    pty_state: &crate::pty::PtyManagerState,
) {
    if let Err(e) = engine::cleanup_session_for_task_engine_switch(
        engine_id.clone(),
        session_id.clone(),
        config,
        pty_state,
    ) {
        tracing::warn!(
            engine_id = %engine_id,
            session_id = ?session_id,
            error = %e,
            "task_switch: session cleanup failed after DB success; binding already updated, orphan session may be recovered later"
        );
    }
}
