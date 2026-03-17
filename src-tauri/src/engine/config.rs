use crate::config::{
    migrate_engine_profiles, write_config_to_disk, AppConfigState, EngineConfig, EngineProfile,
};
use std::collections::BTreeMap;
use tauri::AppHandle;

pub fn engine_list_core(config: &AppConfigState) -> BTreeMap<String, EngineConfig> {
    config.get().engines
}

pub fn engine_upsert_core(
    app: &AppHandle,
    id: String,
    engine: EngineConfig,
    config_state: &AppConfigState,
) -> Result<(), String> {
    let mut config = config_state.get();
    config.engines.insert(id, engine);
    migrate_engine_profiles(&mut config);
    write_config_to_disk(app, &config)?;
    config_state.set(config);
    Ok(())
}

pub fn engine_set_active_profile_core(
    app: &AppHandle,
    engine_id: String,
    profile_id: String,
    config_state: &AppConfigState,
) -> Result<(), String> {
    let mut config = config_state.get();
    let engine = config
        .engines
        .get_mut(&engine_id)
        .ok_or_else(|| format!("engine not found: {engine_id}"))?;
    if !engine.profiles.contains_key(&profile_id) {
        return Err(format!("profile not found: {profile_id}"));
    }
    engine.active_profile_id = profile_id;
    write_config_to_disk(app, &config)?;
    config_state.set(config);
    Ok(())
}

pub fn engine_upsert_profile_core(
    app: &AppHandle,
    engine_id: String,
    profile_id: String,
    profile: EngineProfile,
    config_state: &AppConfigState,
) -> Result<(), String> {
    let mut config = config_state.get();
    let engine = config
        .engines
        .get_mut(&engine_id)
        .ok_or_else(|| format!("engine not found: {engine_id}"))?;
    engine.profiles.insert(
        profile_id.clone(),
        EngineProfile {
            id: profile_id.clone(),
            ..profile
        },
    );
    if engine.active_profile_id.trim().is_empty() {
        engine.active_profile_id = profile_id;
    }
    write_config_to_disk(app, &config)?;
    config_state.set(config);
    Ok(())
}

