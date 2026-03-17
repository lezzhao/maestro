use crate::config::AppConfig;
use crate::core::error::CoreError;
use crate::task_runtime::{
    resolve_task_runtime_context, ResolvedRuntimeContext, RuntimeSnapshot, RuntimeSnapshotPayload,
};
use crate::task_state::{self, bmad_db_path};
use tauri::AppHandle;

/// Ensures a runtime snapshot exists for the given task.
/// If it doesn't exist, resolves the live context and freezes it.
pub fn ensure_runtime_snapshot(
    app: &AppHandle,
    task_id: &str,
    config: &AppConfig,
) -> Result<String, CoreError> {
    let db_path = bmad_db_path(app).map_err(|e| CoreError::Io {
        message: format!("resolve db path failed: {e}"),
    })?;

    let binding = task_state::get_task_runtime_binding(&db_path, task_id)
        .map_err(|e| CoreError::Io {
            message: format!("get task binding failed: {e}"),
        })?
        .ok_or_else(|| CoreError::NotFound {
            resource: "task".to_string(),
            id: task_id.to_string(),
        })?;

    if let Some(snapshot_id) = binding.runtime_snapshot_id {
        if !snapshot_id.is_empty() {
            return Ok(snapshot_id);
        }
    }

    // Resolve context from config
    let ctx = resolve_task_runtime_context(&db_path, task_id, config)?;

    // Create snapshot payload
    let payload = RuntimeSnapshotPayload {
        engine_id: ctx.engine_id.clone(),
        profile_id: ctx.profile_id.clone(),
        command: ctx.command,
        args: ctx.args,
        env: ctx.env,
        execution_mode: ctx.execution_mode,
        model: ctx.model,
        api_provider: ctx.api_provider,
        api_base_url: ctx.api_base_url,
        supports_headless: ctx.supports_headless,
        ready_signal: ctx.ready_signal,
        exit_command: ctx.exit_command,
        exit_timeout_ms: ctx.exit_timeout_ms,
    };

    let payload_json = serde_json::to_string(&payload).map_err(|e| CoreError::Io {
        message: format!("serialize payload failed: {e}"),
    })?;

    let snapshot_id = uuid::Uuid::new_v4().to_string();
    let snapshot = RuntimeSnapshot {
        id: snapshot_id.clone(),
        task_id: task_id.to_string(),
        engine_id: ctx.engine_id.clone(),
        profile_id: ctx.profile_id.clone(),
        payload_json,
        reason: "first_execution".to_string(),
        created_at: "".to_string(),
    };

    crate::snapshot_repository::insert_runtime_snapshot(&db_path, &snapshot).map_err(|e| CoreError::Io {
        message: format!("insert snapshot failed: {e}"),
    })?;

    task_state::update_task_runtime_snapshot(&db_path, task_id, Some(&snapshot_id))
        .map_err(|e| CoreError::Io {
            message: format!("update task snapshot failed: {e}"),
        })?;

    Ok(snapshot_id)
}

/// Prepares the execution binding for a new run.
/// 1. Ensures snapshot exists.
/// 2. Records ExecutionBinding.
/// 3. Returns the resolved runtime context for execution.
pub fn prepare_execution_binding(
    app: &AppHandle,
    execution_id: &str,
    task_id: &str,
    config: &AppConfig,
) -> Result<ResolvedRuntimeContext, CoreError> {
    let db_path = bmad_db_path(app).map_err(|e| CoreError::Io {
        message: format!("resolve db path failed: {e}"),
    })?;

    // 1. Ensure snapshot
    let snapshot_id = ensure_runtime_snapshot(app, task_id, config)?;

    // 2. Resolve to get final ctx for execution (this will load from the snapshot since we just bound it)
    let ctx = resolve_task_runtime_context(&db_path, task_id, config)?;

    // 3. Insert Execution Binding
    let binding = crate::task_runtime::ExecutionBinding {
        execution_id: execution_id.to_string(),
        task_id: task_id.to_string(),
        snapshot_id,
        engine_id: ctx.engine_id.clone(),
        profile_id: ctx.profile_id.clone(),
        created_at: "".to_string(),
    };

    crate::execution_binding_repository::insert_execution_binding(&db_path, &binding).map_err(|e| CoreError::Io {
        message: format!("insert execution binding failed: {e}"),
    })?;

    Ok(ctx)
}
