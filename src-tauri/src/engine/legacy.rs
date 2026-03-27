use crate::config::{EngineConfig, EngineProfile};
use crate::core::error::CoreError;
use std::collections::BTreeMap;
use tauri::{command, State, AppHandle};

use super::{
    models::EngineModelListResult,
    preflight::EnginePreflightResult,
    runtime::EngineSwitchResult,
};

#[command]
pub fn engine_list(core_state: State<'_, crate::core::MaestroCore>) -> Result<BTreeMap<String, EngineConfig>, CoreError> {
    Ok(core_state.inner().engine_list())
}

#[command]
pub fn engine_upsert(
    app: AppHandle,
    id: String,
    engine: EngineConfig,
    core_state: State<'_, crate::core::MaestroCore>,
) -> Result<(), CoreError> {
    core_state.inner().engine_upsert(&app, id, engine)
}

#[command]
pub fn engine_set_active_profile(
    app: AppHandle,
    engine_id: String,
    profile_id: String,
    core_state: State<'_, crate::core::MaestroCore>,
) -> Result<(), CoreError> {
    core_state
        .inner()
        .engine_set_active_profile(&app, engine_id, profile_id)
}

#[command]
pub fn engine_upsert_profile(
    app: AppHandle,
    engine_id: String,
    profile_id: String,
    profile: EngineProfile,
    core_state: State<'_, crate::core::MaestroCore>,
) -> Result<(), CoreError> {
    core_state
        .inner()
        .engine_upsert_profile(&app, engine_id, profile_id, profile)
}

#[command]
pub async fn engine_preflight(
    engine_id: String,
    core_state: State<'_, crate::core::MaestroCore>,
) -> Result<EnginePreflightResult, CoreError> {
    core_state.inner().engine_preflight(engine_id).await
}

#[command]
pub async fn engine_list_models(
    engine_id: String,
    core_state: State<'_, crate::core::MaestroCore>,
) -> Result<EngineModelListResult, CoreError> {
    core_state.inner().engine_list_models(engine_id).await
}

#[command]
pub fn engine_check_command(command: String) -> bool {
    which::which(command).is_ok()
}

#[command]
pub fn engine_delete(
    app: AppHandle,
    id: String,
    core_state: State<'_, crate::core::MaestroCore>,
) -> Result<(), CoreError> {
    core_state.inner().engine_delete(&app, id)
}

#[command]
pub fn engine_switch_session(
    engine_id: String,
    session_id: Option<String>,
    core_state: State<'_, crate::core::MaestroCore>,
) -> Result<EngineSwitchResult, CoreError> {
    core_state.inner().engine_switch_session(engine_id, session_id)
}
