//! Tauri command handlers for task operations.

use crate::core::error::CoreError;
use crate::task::state::{TaskCreateRequest, TaskCreateResult, TaskRuntimeBinding};
use crate::agent_state::TauriEventHandle;
use tauri::Manager;

#[tauri::command]
pub async fn task_create(
    app: tauri::AppHandle,
    request: TaskCreateRequest,
) -> Result<TaskCreateResult, CoreError> {
    let core = app.state::<crate::core::MaestroCore>();
    core.task_create(&app, request)
}

#[tauri::command]
pub async fn task_transition(
    app: tauri::AppHandle,
    request: crate::task::state::TaskTransitionRequest,
) -> Result<String, CoreError> {
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
) -> Result<crate::task::runtime::ResolvedRuntimeContext, CoreError> {
    let core = app.state::<crate::core::MaestroCore>();
    let cfg = core.config.get();
    crate::task::runtime::resolve_task_runtime_context_for_app(&app, &request.task_id, &cfg).map_err(
        |e| CoreError::SystemError {
            message: format!("resolve context failed: {:?}", e),
        },
    )
}

#[tauri::command]
pub async fn task_get_runtime_binding(
    app: tauri::AppHandle,
    request: TaskGetRuntimeBindingRequest,
) -> Result<Option<TaskRuntimeBinding>, CoreError> {
    let db_path = crate::task::state::maestro_db_path(&app)?;
    crate::task::state::get_task_runtime_binding(&db_path, &request.task_id)
}

#[tauri::command]
pub async fn task_refresh_runtime_snapshot(
    app: tauri::AppHandle,
    request: TaskRefreshRuntimeSnapshotRequest,
) -> Result<(), CoreError> {
    crate::task::runtime_service::invalidate_runtime_snapshot(&app, &request.task_id)
        .map_err(CoreError::from)?;
    let core = app.state::<crate::core::MaestroCore>();
    let cfg = core.config.get();
    let _ = crate::storage::execution_binding::ensure_runtime_snapshot(
        TauriEventHandle::arc(app.clone()),
        &request.task_id,
        &cfg
    ).map_err(|e| CoreError::SystemError {
        message: format!("refresh snapshot failed: {:?}", e),
    })?;

    let db_path = crate::task::state::maestro_db_path(&app)?;
    if let Ok(Some(binding)) = crate::task::state::get_task_runtime_binding(&db_path, &request.task_id) {
        crate::agent_state::emit_state_update(
            Some(&app),
            crate::agent_state::AgentStateUpdate::TaskRuntimeBindingChanged {
                task_id: request.task_id.clone(),
                binding,
            },
            None,
        );
    }
    if let Ok(ctx) =
        crate::task::runtime::resolve_task_runtime_context_for_app(&app, &request.task_id, &cfg)
    {
        crate::agent_state::emit_state_update(
            Some(&app),
            crate::agent_state::AgentStateUpdate::TaskRuntimeContextResolved {
                task_id: request.task_id.clone(),
                context: ctx,
            },
            None,
        );
    }
    Ok(())
}

#[tauri::command]
pub async fn task_switch_runtime_binding(
    app: tauri::AppHandle,
    request: crate::task::state::TaskSwitchRuntimeBindingRequest,
) -> Result<(), CoreError> {
    let core = app.state::<crate::core::MaestroCore>();
    core.task_switch_runtime_binding(&app, request)
}

#[tauri::command]
pub async fn task_update_runtime_binding(
    app: tauri::AppHandle,
    request: crate::task::state::TaskUpdateRuntimeBindingRequest,
) -> Result<(), CoreError> {
    let core = app.state::<crate::core::MaestroCore>();
    core.task_update_runtime_binding(&app, request)
}

#[tauri::command]
pub async fn task_delete(app: tauri::AppHandle, task_id: String) -> Result<(), CoreError> {
    let core = app.state::<crate::core::MaestroCore>();
    core.task_delete(&app, task_id)
}

#[tauri::command]
pub async fn task_list(
    app: tauri::AppHandle,
) -> Result<Vec<crate::agent_state::TaskRecordPayload>, CoreError> {
    let core = app.state::<crate::core::MaestroCore>();
    core.task_list(&app)
}

#[tauri::command]
pub async fn task_update(
    app: tauri::AppHandle,
    request: crate::task::state::TaskUpdateRequest,
) -> Result<(), CoreError> {
    let core = app.state::<crate::core::MaestroCore>();
    core.task_update(&app, request)
}

#[tauri::command]
pub async fn task_get_state(
    app: tauri::AppHandle,
    request: crate::task::state::TaskGetStateRequest,
) -> Result<Option<String>, CoreError> {
    let core = app.state::<crate::core::MaestroCore>();
    core.get_task_state(&app, request)
}
