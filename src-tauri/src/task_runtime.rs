//! Task runtime context: authoritative resolution of engine + profile for a task.
//! Provides the single source of truth for "which profile does this task run with".
//! When task has runtime_snapshot_id, uses snapshot for reproducibility; else resolves from config.

use crate::config::{AppConfig, EngineProfile};
use crate::core::error::CoreError;
use crate::profile_snapshot;
use crate::task_state::{self, bmad_db_path};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::AppHandle;

/// Task runtime context: the authoritative binding of engine + profile for a task.
/// Reference-style in current phase (points to config, not a snapshot).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskRuntimeContext {
    pub engine_id: String,
    pub profile_id: String,
}

/// Resolved runtime context with the actual profile for execution.
#[derive(Debug, Clone)]
pub struct ResolvedTaskRuntimeContext {
    pub engine_id: String,
    pub profile_id: String,
    pub profile: EngineProfile,
}

/// Resolve task runtime context from DB + config.
/// - If task has runtime_snapshot_id, loads profile from snapshot (reproducibility)
/// - Else: reads task.engine_id, task.profile_id; fallback to engine.active_profile_id
pub fn resolve_task_runtime_context(
    db_path: &Path,
    task_id: &str,
    cfg: &AppConfig,
) -> Result<ResolvedTaskRuntimeContext, CoreError> {
    let binding = task_state::get_task_runtime_binding(db_path, task_id)
        .map_err(|e| CoreError::Io {
            message: format!("get task binding failed: {e}"),
        })?
        .ok_or_else(|| CoreError::NotFound {
            resource: "task".to_string(),
            id: task_id.to_string(),
        })?;

    // Prefer snapshot when available (reproducibility)
    if let Some(ref snapshot_id) = binding.runtime_snapshot_id {
        if !snapshot_id.is_empty() {
            if let Ok(Some(profile)) = profile_snapshot::get_snapshot(db_path, snapshot_id) {
                let profile_id = profile.id.clone();
                let profile_id = if profile_id.is_empty() {
                    binding.profile_id.clone().unwrap_or_else(|| "default".to_string())
                } else {
                    profile_id
                };
                return Ok(ResolvedTaskRuntimeContext {
                    engine_id: binding.engine_id,
                    profile_id,
                    profile,
                });
            }
        }
    }

    // Fallback: resolve from config (reference-style)
    let engine = cfg
        .engines
        .get(&binding.engine_id)
        .ok_or_else(|| CoreError::NotFound {
            resource: "engine".to_string(),
            id: binding.engine_id.clone(),
        })?;

    let profile_id = binding
        .profile_id
        .filter(|s| !s.is_empty())
        .or_else(|| {
            let aid = &engine.active_profile_id;
            if aid.is_empty() {
                None
            } else {
                Some(aid.clone())
            }
        })
        .or_else(|| engine.profiles.keys().next().cloned());

    let profile_id = profile_id.ok_or_else(|| CoreError::NotFound {
        resource: "profile".to_string(),
        id: "no profile in engine".to_string(),
    })?;

    let (profile_id, profile) = engine
        .profiles
        .get(&profile_id)
        .map(|p| (profile_id.clone(), p.clone()))
        .or_else(|| {
            engine
                .profiles
                .iter()
                .next()
                .map(|(id, p)| (id.clone(), p.clone()))
        })
        .ok_or_else(|| CoreError::NotFound {
            resource: "profile".to_string(),
            id: "no profile in engine".to_string(),
        })?;

    Ok(ResolvedTaskRuntimeContext {
        engine_id: binding.engine_id,
        profile_id,
        profile,
    })
}

/// Create a profile snapshot and pin the task to it (for reproducibility).
/// Call at execution start when app and task_id are available.
pub fn create_snapshot_and_pin_task(
    app: &AppHandle,
    task_id: &str,
    engine_id: &str,
    profile_id: &str,
    profile: &EngineProfile,
) -> Result<(), CoreError> {
    let db_path = bmad_db_path(app).map_err(|e| CoreError::Io {
        message: format!("resolve db path failed: {e}"),
    })?;
    let snapshot_id = profile_snapshot::create_snapshot(&db_path, engine_id, profile_id, profile)
        .map_err(|e| CoreError::Io {
            message: format!("create snapshot failed: {e}"),
        })?;
    task_state::update_task_runtime_snapshot(&db_path, task_id, Some(&snapshot_id))
        .map_err(|e| CoreError::Io {
            message: format!("update task snapshot failed: {e}"),
        })?;
    Ok(())
}

/// Resolve task runtime context using app handle (for use in commands).
pub fn resolve_task_runtime_context_for_app(
    app: &AppHandle,
    task_id: &str,
    cfg: &AppConfig,
) -> Result<ResolvedTaskRuntimeContext, CoreError> {
    let db_path = bmad_db_path(app).map_err(|e| CoreError::Io {
        message: format!("resolve db path failed: {e}"),
    })?;
    resolve_task_runtime_context(&db_path, task_id, cfg)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{EngineConfig, EngineProfile};
    use std::collections::BTreeMap;
    use std::path::PathBuf;

    fn temp_db_path() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("test_bmad_state.db");
        (dir, path)
    }

    fn mock_profile(id: &str) -> EngineProfile {
        EngineProfile {
            id: id.to_string(),
            display_name: id.to_string(),
            command: "test".to_string(),
            args: vec![],
            env: BTreeMap::new(),
            ..Default::default()
        }
    }

    #[test]
    fn resolve_uses_task_profile_id_when_valid() {
        let (_dir, db_path) = temp_db_path();
        let task_id = task_state::create_task(
            &db_path,
            "Task",
            "",
            "eng1",
            "{}",
            Some("profile_b"),
        )
        .expect("create_task");

        let mut profiles = BTreeMap::new();
        profiles.insert("profile_a".to_string(), mock_profile("profile_a"));
        profiles.insert("profile_b".to_string(), mock_profile("profile_b"));
        let engine = EngineConfig {
            id: "eng1".to_string(),
            plugin_type: "cli".to_string(),
            display_name: "Engine".to_string(),
            icon: "".to_string(),
            profiles: profiles.clone(),
            active_profile_id: "profile_a".to_string(),
            legacy_profile: mock_profile("default"),
        };
        let mut engines = BTreeMap::new();
        engines.insert("eng1".to_string(), engine);
        let mut cfg = AppConfig::default();
        cfg.engines = engines;

        let resolved = resolve_task_runtime_context(&db_path, &task_id, &cfg).expect("resolve");
        assert_eq!(resolved.engine_id, "eng1");
        assert_eq!(resolved.profile_id, "profile_b");
        assert_eq!(resolved.profile.id, "profile_b");
    }

    #[test]
    fn resolve_falls_back_to_active_profile_when_task_profile_empty() {
        let (_dir, db_path) = temp_db_path();
        let task_id = task_state::create_task(&db_path, "Task", "", "eng1", "{}", None)
            .expect("create_task");

        let mut profiles = BTreeMap::new();
        profiles.insert("default".to_string(), mock_profile("default"));
        let engine = EngineConfig {
            id: "eng1".to_string(),
            plugin_type: "cli".to_string(),
            display_name: "Engine".to_string(),
            icon: "".to_string(),
            profiles: profiles.clone(),
            active_profile_id: "default".to_string(),
            legacy_profile: mock_profile("default"),
        };
        let mut engines = BTreeMap::new();
        engines.insert("eng1".to_string(), engine);
        let mut cfg = AppConfig::default();
        cfg.engines = engines;

        let resolved = resolve_task_runtime_context(&db_path, &task_id, &cfg).expect("resolve");
        assert_eq!(resolved.profile_id, "default");
    }

    #[test]
    fn resolve_uses_snapshot_when_task_has_runtime_snapshot_id() {
        let (_dir, db_path) = temp_db_path();
        let task_id = task_state::create_task(&db_path, "Task", "", "eng1", "{}", Some("profile_a"))
            .expect("create_task");

        // Create a snapshot with different profile content
        let snap_profile = EngineProfile {
            id: "profile_a".to_string(),
            display_name: "Snapshot Profile".to_string(),
            command: "snap-cmd".to_string(),
            model: Some("snapshot-model".to_string()),
            ..mock_profile("profile_a")
        };
        let snapshot_id = profile_snapshot::create_snapshot(&db_path, "eng1", "profile_a", &snap_profile)
            .expect("create_snapshot");
        task_state::update_task_runtime_snapshot(&db_path, &task_id, Some(&snapshot_id))
            .expect("update_task_runtime_snapshot");

        let mut profiles = BTreeMap::new();
        profiles.insert("profile_a".to_string(), mock_profile("profile_a")); // config has different content
        let engine = EngineConfig {
            id: "eng1".to_string(),
            plugin_type: "cli".to_string(),
            display_name: "Engine".to_string(),
            icon: "".to_string(),
            profiles,
            active_profile_id: "profile_a".to_string(),
            legacy_profile: mock_profile("default"),
        };
        let mut engines = BTreeMap::new();
        engines.insert("eng1".to_string(), engine);
        let mut cfg = AppConfig::default();
        cfg.engines = engines;

        let resolved = resolve_task_runtime_context(&db_path, &task_id, &cfg).expect("resolve");
        assert_eq!(resolved.profile_id, "profile_a");
        assert_eq!(resolved.profile.command, "snap-cmd");
        assert_eq!(resolved.profile.model, Some("snapshot-model".to_string()));
    }

    #[test]
    fn resolve_returns_not_found_for_missing_task() {
        let (_dir, db_path) = temp_db_path();
        let mut profiles = BTreeMap::new();
        profiles.insert("default".to_string(), mock_profile("default"));
        let engine = EngineConfig {
            id: "eng1".to_string(),
            plugin_type: "cli".to_string(),
            display_name: "Engine".to_string(),
            icon: "".to_string(),
            profiles,
            active_profile_id: "default".to_string(),
            legacy_profile: mock_profile("default"),
        };
        let mut engines = BTreeMap::new();
        engines.insert("eng1".to_string(), engine);
        let mut cfg = AppConfig::default();
        cfg.engines = engines;

        let err = resolve_task_runtime_context(&db_path, "nonexistent", &cfg).unwrap_err();
        assert!(matches!(err, CoreError::NotFound { resource, .. } if resource == "task"));
    }
}
