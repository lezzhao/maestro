use super::MaestroCore;
use std::collections::BTreeMap;
use tauri::AppHandle;
use crate::config::{EngineConfig, EngineProfile};
use crate::engine::{EngineModelListResult, EnginePreflightResult};

impl MaestroCore {
    pub fn engine_list(&self) -> BTreeMap<String, EngineConfig> {
        crate::engine::engine_list_core(&self.config)
    }

    pub fn engine_upsert(&self, app: &AppHandle, id: String, engine: EngineConfig) -> Result<(), String> {
        crate::engine::engine_upsert_core(app, id, engine, &self.config)
    }

    pub fn engine_set_active_profile(
        &self,
        app: &AppHandle,
        engine_id: String,
        profile_id: String,
    ) -> Result<(), String> {
        crate::engine::engine_set_active_profile_core(app, engine_id, profile_id, &self.config)
    }

    pub fn engine_upsert_profile(
        &self,
        app: &AppHandle,
        engine_id: String,
        profile_id: String,
        profile: EngineProfile,
    ) -> Result<(), String> {
        crate::engine::engine_upsert_profile_core(app, engine_id, profile_id, profile, &self.config)
    }

    pub async fn engine_preflight(&self, engine_id: String) -> Result<EnginePreflightResult, String> {
        crate::engine::engine_preflight_core(engine_id, self.config.get()).await
    }

    pub async fn engine_list_models(&self, engine_id: String) -> Result<EngineModelListResult, String> {
        crate::engine::engine_list_models_core(engine_id, self.config.get()).await
    }

    pub fn engine_switch_session(
        &self,
        engine_id: String,
        session_id: Option<String>,
    ) -> Result<crate::engine::EngineSwitchResult, String> {
        crate::engine::cleanup_session_for_task_engine_switch(
            engine_id,
            session_id,
            self.config.get(),
            &self.pty_state,
        )
    }
}
