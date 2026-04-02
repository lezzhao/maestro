//! Engine configuration CRUD and profile management. Persists to disk.
//! Does NOT handle task-level logic or session lifecycle.

use crate::config::{
    migration::migrate_engine_profiles, write_config_to_disk, AppConfigState, EngineConfig,
    EngineProfile,
};
use std::collections::BTreeMap;
use tauri::AppHandle;

pub fn engine_list_core(config: &AppConfigState) -> BTreeMap<String, EngineConfig> {
    config.get().engines.clone()
}

pub fn engine_upsert_core(
    app: &AppHandle,
    id: String,
    engine: EngineConfig,
    config_state: &AppConfigState,
) -> Result<(), String> {
    let mut config = (*config_state.get()).clone();
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
    let mut config = (*config_state.get()).clone();
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
    let mut config = (*config_state.get()).clone();
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
    // Migration-only fallback: ensure engine has valid active_profile_id.
    // DEPRECATED: see docs/MIGRATION_FALLBACK_DEPRECATION.md
    if engine.active_profile_id.trim().is_empty() {
        tracing::warn!(
            engine_id = %engine_id,
            profile_id = %profile_id,
            "migration fallback: engine had no active_profile_id, set to current profile"
        );
        engine.active_profile_id = profile_id;
    }
    write_config_to_disk(app, &config)?;
    config_state.set(config);
    Ok(())
}

pub fn engine_delete_core(
    app: &AppHandle,
    id: String,
    config_state: &AppConfigState,
) -> Result<(), String> {
    tracing::info!(engine_id = %id, "engine_delete_core: starting deletion");
    let mut config = (*config_state.get()).clone();

    if config.engines.remove(&id).is_some() {
        tracing::info!(engine_id = %id, "engine_delete_core: removed from memory map");
        write_config_to_disk(app, &config)?;
        tracing::info!(engine_id = %id, "engine_delete_core: disk config updated");
        config_state.set(config);
        Ok(())
    } else {
        tracing::warn!(engine_id = %id, "engine_delete_core: engine not found in map");
        Err(format!("engine not found: {id}"))
    }
}
