//! Tauri command handlers for task operations.

use crate::task_state::{self, TaskCreateRequest, TaskCreateResult, TaskRuntimeBinding};
use tauri::Manager;

#[tauri::command]
pub async fn task_create(app: tauri::AppHandle, request: TaskCreateRequest) -> Result<TaskCreateResult, String> {
    let core = app.state::<crate::core::MaestroCore>();
    core.task_create(&app, request)
}

#[tauri::command]
pub async fn task_transition(
    app: tauri::AppHandle,
    request: task_state::TaskTransitionRequest,
) -> Result<String, String> {
    let core = app.state::<crate::core::MaestroCore>();
    core.task_transition(&app, request)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskGetRuntimeContextRequest {
    pub task_id: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskGetRuntimeBindingRequest {
    pub task_id: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskRefreshRuntimeSnapshotRequest {
    pub task_id: String,
}

#[tauri::command]
pub async fn task_get_runtime_context(
    app: tauri::AppHandle,
    request: TaskGetRuntimeContextRequest,
) -> Result<crate::task_runtime::ResolvedRuntimeContext, String> {
    let core = app.state::<crate::core::MaestroCore>();
    let cfg = core.config.get();
    crate::task_runtime::resolve_task_runtime_context_for_app(&app, &request.task_id, &cfg)
        .map_err(|e| format!("resolve context failed: {:?}", e))
}

#[tauri::command]
pub async fn task_get_runtime_binding(
    app: tauri::AppHandle,
    request: TaskGetRuntimeBindingRequest,
) -> Result<Option<TaskRuntimeBinding>, String> {
    let db_path = task_state::bmad_db_path(&app)?;
    task_state::get_task_runtime_binding(&db_path, &request.task_id)
}

#[tauri::command]
pub async fn task_refresh_runtime_snapshot(
    app: tauri::AppHandle,
    request: TaskRefreshRuntimeSnapshotRequest,
) -> Result<(), String> {
    crate::task_runtime_service::invalidate_runtime_snapshot(&app, &request.task_id)?;
    let core = app.state::<crate::core::MaestroCore>();
    let cfg = core.config.get();
    let _ = crate::execution_binding::ensure_runtime_snapshot(&app, &request.task_id, &cfg)
        .map_err(|e| format!("refresh snapshot failed: {:?}", e))?;

    let db_path = task_state::bmad_db_path(&app)?;
    if let Ok(Some(binding)) = task_state::get_task_runtime_binding(&db_path, &request.task_id) {
        crate::agent_state::emit_state_update(
            Some(&app),
            crate::agent_state::AgentStateUpdate::TaskRuntimeBindingChanged {
                task_id: request.task_id.clone(),
                binding,
            },
        );
    }
    if let Ok(ctx) =
        crate::task_runtime::resolve_task_runtime_context_for_app(&app, &request.task_id, &cfg)
    {
        crate::agent_state::emit_state_update(
            Some(&app),
            crate::agent_state::AgentStateUpdate::TaskRuntimeContextResolved {
                task_id: request.task_id.clone(),
                context: ctx,
            },
        );
    }
    Ok(())
}

#[tauri::command]
pub async fn task_switch_runtime_binding(
    app: tauri::AppHandle,
    request: task_state::TaskSwitchRuntimeBindingRequest,
) -> Result<(), String> {
    let core = app.state::<crate::core::MaestroCore>();
    core.task_switch_runtime_binding(&app, request)
}

#[tauri::command]
pub async fn task_update_runtime_binding(
    app: tauri::AppHandle,
    request: task_state::TaskUpdateRuntimeBindingRequest,
) -> Result<(), String> {
    let core = app.state::<crate::core::MaestroCore>();
    core.task_update_runtime_binding(&app, request)
}

#[tauri::command]
pub async fn task_delete(app: tauri::AppHandle, task_id: String) -> Result<(), String> {
    let core = app.state::<crate::core::MaestroCore>();
    core.task_delete(&app, task_id)
}

#[tauri::command]
pub async fn task_list(app: tauri::AppHandle) -> Result<Vec<crate::agent_state::TaskRecordPayload>, String> {
    let core = app.state::<crate::core::MaestroCore>();
    core.task_list(&app)
}

#[tauri::command]
pub async fn task_get_state(
    app: tauri::AppHandle,
    request: task_state::TaskGetStateRequest,
) -> Result<Option<String>, String> {
    let core = app.state::<crate::core::MaestroCore>();
    core.task_get_state(&app, request)
}
