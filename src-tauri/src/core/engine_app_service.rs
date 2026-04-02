use super::error;
use super::MaestroCore;
use crate::config::{EngineConfig, EngineProfile};
use crate::engine::{EngineModelListResult, EnginePreflightResult};
use std::collections::BTreeMap;
use tauri::AppHandle;

impl MaestroCore {
    pub fn engine_list(&self) -> BTreeMap<String, EngineConfig> {
        crate::engine::engine_list_core(&self.config)
    }

    pub fn engine_upsert(
        &self,
        app: &AppHandle,
        id: String,
        engine: EngineConfig,
    ) -> Result<(), error::CoreError> {
        crate::engine::engine_upsert_core(app, id, engine, &self.config)
            .map_err(error::CoreError::from)
    }

    pub fn engine_set_active_profile(
        &self,
        app: &AppHandle,
        engine_id: String,
        profile_id: String,
    ) -> Result<(), error::CoreError> {
        crate::engine::engine_set_active_profile_core(app, engine_id, profile_id, &self.config)
            .map_err(error::CoreError::from)
    }

    pub fn engine_upsert_profile(
        &self,
        app: &AppHandle,
        engine_id: String,
        profile_id: String,
        profile: EngineProfile,
    ) -> Result<(), error::CoreError> {
        crate::engine::engine_upsert_profile_core(app, engine_id, profile_id, profile, &self.config)
            .map_err(error::CoreError::from)
    }

    pub async fn engine_preflight(
        &self,
        engine_id: String,
        profile_id: Option<String>,
    ) -> Result<EnginePreflightResult, error::CoreError> {
        crate::engine::engine_preflight_core(engine_id, profile_id, (*self.config.get()).clone())
            .await
            .map_err(error::CoreError::from)
    }

    pub async fn engine_list_models(
        &self,
        engine_id: String,
    ) -> Result<EngineModelListResult, error::CoreError> {
        crate::engine::engine_list_models_core(engine_id, (*self.config.get()).clone())
            .await
            .map_err(error::CoreError::from)
    }

    pub fn engine_switch_session(
        &self,
        engine_id: String,
        session_id: Option<String>,
    ) -> Result<crate::engine::EngineSwitchResult, error::CoreError> {
        crate::engine::cleanup_session_for_task_engine_switch(
            engine_id,
            session_id,
            (*self.config.get()).clone(),
            &self.pty_state,
        )
        .map_err(error::CoreError::from)
    }
    pub fn engine_delete(&self, app: &AppHandle, id: String) -> Result<(), error::CoreError> {
        crate::engine::engine_delete_core(app, id, &self.config).map_err(error::CoreError::from)
    }
}
