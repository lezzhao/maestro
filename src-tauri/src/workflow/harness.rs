use crate::core::MaestroCore;
use crate::core::error::CoreError;
use crate::core::harness::session::HarnessSession;
use tauri::{command, State};
use std::sync::Arc;

#[command]
pub async fn harness_get_session(
    task_id: String,
    core: State<'_, Arc<MaestroCore>>,
) -> Result<HarnessSession, CoreError> {
    core.harness_get_session(&task_id)
}

#[command]
pub async fn harness_transition(
    task_id: String,
    new_mode: String,
    core: State<'_, Arc<MaestroCore>>,
) -> Result<(), CoreError> {
    core.harness_transition(&task_id, &new_mode)
}

#[command]
pub async fn harness_update_plan(
    task_id: String,
    plan: String,
    core: State<'_, Arc<MaestroCore>>,
) -> Result<(), CoreError> {
    core.harness_update_plan(&task_id, &plan)
}
