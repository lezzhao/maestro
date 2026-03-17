//! Task runtime service: unified logic for task runtime context resolution and mutation.
//! Extracted from MaestroCore to clarify domain boundaries.

use crate::agent_state::{emit_state_update, AgentStateUpdate};
use crate::config::AppConfig;
use crate::task_state;
use tauri::AppHandle;

/// Resolve profile_id for a task runtime context update.
/// Uses request profile_id if provided; engine.active_profile_id is migration-only fallback.
pub fn resolve_profile_id_for_update(
    config: &AppConfig,
    engine_id: &str,
    profile_id: Option<String>,
) -> Option<String> {
    profile_id.or_else(|| {
        config
            .engines
            .get(engine_id)
            .map(|e| e.active_profile_id.clone())
    })
}

/// Update task's runtime context (engine_id + profile_id) in DB and emit event.
/// Engine/profile change automatically invalidates runtime_snapshot_id (cleared by update_task_engine).
/// Caller is responsible for session cleanup when needed (e.g. before calling for task_switch_engine).
pub fn update_task_runtime_context(
    app: &AppHandle,
    task_id: &str,
    engine_id: &str,
    profile_id: Option<String>,
    config: &AppConfig,
) -> Result<(), String> {
    if !config.engines.contains_key(engine_id) {
        return Err(format!("engine not found: {}", engine_id));
    }

    let profile_id = resolve_profile_id_for_update(config, engine_id, profile_id);

    let db_path = task_state::bmad_db_path(app)?;
    task_state::update_task_engine(&db_path, task_id, engine_id, profile_id.as_deref())?;

    if let Ok(Some(binding)) = task_state::get_task_runtime_binding(&db_path, task_id) {
        emit_state_update(
            Some(app),
            AgentStateUpdate::TaskRuntimeBindingChanged {
                task_id: task_id.to_string(),
                binding,
            },
        );
    }

    if let Ok(ctx) = crate::task_runtime::resolve_task_runtime_context_for_app(app, task_id, config) {
        emit_state_update(
            Some(app),
            AgentStateUpdate::TaskRuntimeContextResolved {
                task_id: task_id.to_string(),
                context: ctx,
            },
        );
    }

    Ok(())
}

/// Explicitly invalidate the runtime snapshot for a task.
pub fn invalidate_runtime_snapshot(app: &AppHandle, task_id: &str) -> Result<(), String> {
    let db_path = task_state::bmad_db_path(app)?;
    task_state::update_task_runtime_snapshot(&db_path, task_id, None)?;
    Ok(())
}
