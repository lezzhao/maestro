//! Tauri command handlers for task operations.

use crate::core::error::CoreError;
use crate::task::state::{TaskCreateRequest, TaskCreateResult, TaskRuntimeBinding};
use crate::agent_state::emitter::AppEventHandle;
use std::sync::Arc;
use tauri::Manager;

#[tauri::command]
pub async fn task_create(
    app: tauri::AppHandle,
    request: TaskCreateRequest,
) -> Result<TaskCreateResult, CoreError> {
    let core = app.state::<Arc<crate::core::MaestroCore>>();
    core.task_create(request)
}

#[tauri::command]
pub async fn task_transition(
    app: tauri::AppHandle,
    request: crate::task::state::TaskTransitionRequest,
) -> Result<String, CoreError> {
    let core = app.state::<Arc<crate::core::MaestroCore>>();
    core.task_transition(request)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskResumeRequest {
    pub task_id: String,
    pub resolution: String,
}

#[tauri::command]
pub async fn task_resume(
    app: tauri::AppHandle,
    _request: TaskResumeRequest,
) -> Result<(), CoreError> {
    let _core = app.state::<Arc<crate::core::MaestroCore>>();
    // Implementation for resumption will be added to MaestroCore
    // core.task_resume(request)
    Ok(())
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
    let core = app.state::<Arc<crate::core::MaestroCore>>();
    let cfg = core.config.get();
    crate::task::runtime::resolve_task_runtime_context_with_db(&core.state_db_path, &request.task_id, &cfg).map_err(
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
    let core = app.state::<Arc<crate::core::MaestroCore>>();
    crate::task::state::get_task_runtime_binding(&core.state_db_path, &request.task_id)
}

#[tauri::command]
pub async fn task_refresh_runtime_snapshot(
    app: tauri::AppHandle,
    request: TaskRefreshRuntimeSnapshotRequest,
) -> Result<(), CoreError> {
    let core = app.state::<Arc<crate::core::MaestroCore>>();
    crate::task::runtime_service::invalidate_runtime_snapshot(&core.state_db_path, &request.task_id)
        .map_err(CoreError::from)?;
    let cfg = core.config.get();
    let _ = crate::storage::execution_binding::ensure_runtime_snapshot(
        core.event_registry.clone(),
        &request.task_id,
        &cfg
    ).map_err(|e| CoreError::SystemError {
        message: format!("refresh snapshot failed: {:?}", e),
    })?;

    if let Ok(Some(binding)) = crate::task::state::get_task_runtime_binding(&core.state_db_path, &request.task_id) {
        core.event_registry.emit_state_update(
            crate::agent_state::AgentStateUpdate::TaskRuntimeBindingChanged {
                task_id: request.task_id.clone(),
                binding,
            },
        );
    }
    if let Ok(ctx) =
        crate::task::runtime::resolve_task_runtime_context_with_db(&core.state_db_path, &request.task_id, &cfg)
    {
        core.event_registry.emit_state_update(
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
    request: crate::task::state::TaskSwitchRuntimeBindingRequest,
) -> Result<(), CoreError> {
    let core = app.state::<Arc<crate::core::MaestroCore>>();
    core.task_switch_runtime_binding(request)
}

#[tauri::command]
pub async fn task_update_runtime_binding(
    app: tauri::AppHandle,
    request: crate::task::state::TaskUpdateRuntimeBindingRequest,
) -> Result<(), CoreError> {
    let core = app.state::<Arc<crate::core::MaestroCore>>();
    core.task_update_runtime_binding(request)
}

#[tauri::command]
pub async fn task_delete(app: tauri::AppHandle, task_id: String) -> Result<(), CoreError> {
    let core = app.state::<Arc<crate::core::MaestroCore>>();
    core.task_delete(task_id)
}

#[tauri::command]
pub async fn task_list(
    app: tauri::AppHandle,
) -> Result<Vec<crate::agent_state::TaskRecordPayload>, CoreError> {
    let core = app.state::<Arc<crate::core::MaestroCore>>();
    core.task_list()
}

#[tauri::command]
pub async fn task_update(
    app: tauri::AppHandle,
    request: crate::task::state::TaskUpdateRequest,
) -> Result<(), CoreError> {
    let core = app.state::<Arc<crate::core::MaestroCore>>();
    core.task_update(request)
}

#[tauri::command]
pub async fn task_get_state(
    app: tauri::AppHandle,
    request: crate::task::state::TaskGetStateRequest,
) -> Result<Option<String>, CoreError> {
    let core = app.state::<Arc<crate::core::MaestroCore>>();
    core.get_task_state(request)
}
