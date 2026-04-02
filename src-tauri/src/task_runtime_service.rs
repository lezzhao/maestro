//! Task runtime service: unified logic for task runtime context resolution and mutation.
//! Extracted from MaestroCore to clarify domain boundaries.
//!
//! Mutation semantics: DB update is authoritative. Event emission is delegated to the caller
//! (task_app_service) which receives an explicit result. Resolve context is best-effort;
//! if it fails after DB success, resolved_context is None and caller may emit binding-only.

use crate::config::AppConfig;
use crate::task_runtime::ResolvedRuntimeContext;
use crate::task_state;
use tauri::AppHandle;

/// Result of updating task runtime context. Caller emits events from this.
/// - binding: always present after successful DB update
/// - resolved_context: None if resolve failed (e.g. engine/profile not found); caller may still emit binding
pub struct UpdateTaskRuntimeContextResult {
    pub binding: crate::task_state::TaskRuntimeBinding,
    pub resolved_context: Option<ResolvedRuntimeContext>,
}

/// Resolve profile_id for a task runtime context update.
/// Business policy: uses request profile_id if provided; else first profile in engine.
/// (task_create requires explicit profile_id; this fallback applies only to switch/update.)
pub fn resolve_profile_id_for_update(
    config: &AppConfig,
    engine_id: &str,
    profile_id: Option<String>,
) -> Option<String> {
    profile_id.or_else(|| {
        config
            .engines
            .get(engine_id)
            .and_then(|e| e.profiles.keys().next().cloned())
    })
}

/// Update task's runtime context (engine_id + profile_id) in DB.
/// Returns result for caller to emit events. Engine/profile change invalidates runtime_snapshot_id.
/// Caller is responsible for session cleanup when needed (e.g. before calling for task_switch_engine).
pub fn update_task_runtime_context(
    app: &AppHandle,
    task_id: &str,
    engine_id: &str,
    profile_id: Option<String>,
    config: &AppConfig,
) -> Result<UpdateTaskRuntimeContextResult, String> {
    if !config.engines.contains_key(engine_id) {
        return Err(format!("engine not found: {}", engine_id));
    }

    let profile_id = resolve_profile_id_for_update(config, engine_id, profile_id);

    let db_path = task_state::maestro_db_path(app).map_err(|e| e.to_string())?;
    task_state::update_task_engine(&db_path, task_id, engine_id, profile_id.as_deref())
        .map_err(|e| e.to_string())?;

    let binding = task_state::get_task_runtime_binding(&db_path, task_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("task not found: {}", task_id))?;

    let resolved_context =
        crate::task_runtime::resolve_task_runtime_context_for_app(app, task_id, config).ok();

    Ok(UpdateTaskRuntimeContextResult {
        binding,
        resolved_context,
    })
}

/// Explicitly invalidate the runtime snapshot for a task.
pub fn invalidate_runtime_snapshot(app: &AppHandle, task_id: &str) -> Result<(), String> {
    let db_path = task_state::maestro_db_path(app).map_err(|e| e.to_string())?;
    task_state::update_task_runtime_snapshot(&db_path, task_id, None).map_err(|e| e.to_string())?;
    Ok(())
}
