use crate::core::error::CoreError;
use crate::workflow::types::{StepRunRequest, StepRunResult, WorkflowRunRequest, WorkflowRunResult};
use std::sync::Arc;
use tauri::{command, AppHandle, State};

#[command]
pub async fn workflow_run_step(
    app: AppHandle,
    request: StepRunRequest,
    core_state: State<'_, std::sync::Arc<crate::core::MaestroCore>>,
) -> Result<StepRunResult, CoreError> {
    core_state
        .workflow_run_step(
            core_state.event_registry.clone(),
            Arc::new(app),
            request,
        )
        .await
}

#[command]
pub async fn workflow_run(
    app: AppHandle,
    request: WorkflowRunRequest,
    core_state: State<'_, std::sync::Arc<crate::core::MaestroCore>>,
) -> Result<WorkflowRunResult, CoreError> {
    core_state
        .workflow_run(
            core_state.event_registry.clone(),
            Arc::new(app),
            request,
        )
        .await
}
