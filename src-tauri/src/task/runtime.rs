//! Task runtime context: authoritative resolution of engine + profile for a task.
//! Provides the single source of truth for "which profile does this task run with".
//! When task has runtime_snapshot_id, uses snapshot for reproducibility; else resolves from config.
//!
//! Snapshot semantics: snapshot freezes the resolved execution contract only (RuntimeSnapshotPayload),
//! not a profile template copy. Reproducible execution reads from runtime_snapshot exclusively.

use crate::config::AppConfig;
use crate::core::error::CoreError;
use crate::task::state::TaskRuntimeBinding;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CascadingSettings {
    pub system_prompt: Option<String>,
}
use std::path::Path;



#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeResolvedFrom {
    Snapshot,
    LiveProfile,
    FallbackProfile,
    ConfigFallback,
}

/// Layer 1: Stable execution input. Snapshot freezes all fields except api_key (runtime-injected).
/// Do not add fields here without migration; new execution params go here, not in metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedExecutionConfig {
    pub command: String,
    pub args: Vec<String>,
    pub env: std::collections::BTreeMap<String, String>,
    pub execution_mode: String,
    pub model: Option<String>,
    pub api_provider: Option<String>,
    pub api_base_url: Option<String>,
    pub api_key: Option<String>,
    pub supports_headless: bool,
    pub headless_args: Vec<String>,
    pub ready_signal: Option<String>,
    pub exit_command: Option<String>,
    pub exit_timeout_ms: Option<u64>,
    pub settings: Option<String>,
    pub system_prompt: Option<String>,
}

/// Layer 3: Event/frontend projection. Composed from metadata + execution.
/// ResolvedRuntimeContext is the flat backward-compat form; do not add new fields here.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedRuntimeContext {
    pub task_id: String,
    pub engine_id: String,
    pub profile_id: Option<String>,
    pub snapshot_id: Option<String>,
    pub command: String,
    pub args: Vec<String>,
    pub env: std::collections::BTreeMap<String, String>,
    pub execution_mode: String,
    pub model: Option<String>,
    pub api_provider: Option<String>,
    pub api_base_url: Option<String>,
    pub api_key: Option<String>,
    pub supports_headless: bool,
    pub headless_args: Vec<String>,
    pub ready_signal: Option<String>,
    pub exit_command: Option<String>,
    pub exit_timeout_ms: Option<u64>,
    pub resolved_from: RuntimeResolvedFrom,
    pub settings: Option<String>,
    pub system_prompt: Option<String>,
}

impl ResolvedRuntimeContext {
    /// Extract execution config. Note: includes api_key here; the snapshot freeze
    /// (to_snapshot_payload) is responsible for excluding api_key.
    pub fn to_execution_config(&self) -> ResolvedExecutionConfig {
        ResolvedExecutionConfig {
            command: self.command.clone(),
            args: self.args.clone(),
            env: self.env.clone(),
            execution_mode: self.execution_mode.clone(),
            model: self.model.clone(),
            api_provider: self.api_provider.clone(),
            api_base_url: self.api_base_url.clone(),
            api_key: self.api_key.clone(),
            supports_headless: self.supports_headless,
            headless_args: self.headless_args.clone(),
            ready_signal: self.ready_signal.clone(),
            exit_command: self.exit_command.clone(),
            exit_timeout_ms: self.exit_timeout_ms,
            settings: self.settings.clone(),
            system_prompt: self.system_prompt.clone(),
        }
    }
}

impl ResolvedExecutionConfig {
    /// Convert to RuntimeSnapshotPayload for freeze. api_key is excluded (runtime-injected only).
    pub fn to_snapshot_payload(
        &self,
        engine_id: &str,
        profile_id: Option<&str>,
    ) -> RuntimeSnapshotPayload {
        RuntimeSnapshotPayload {
            engine_id: engine_id.to_string(),
            profile_id: profile_id.map(|s| s.to_string()),
            command: self.command.clone(),
            args: self.args.clone(),
            env: self.env.clone(),
            execution_mode: self.execution_mode.clone(),
            model: self.model.clone(),
            api_provider: self.api_provider.clone(),
            api_base_url: self.api_base_url.clone(),
            supports_headless: self.supports_headless,
            headless_args: self.headless_args.clone(),
            ready_signal: self.ready_signal.clone(),
            exit_command: self.exit_command.clone(),
            exit_timeout_ms: self.exit_timeout_ms,
            system_prompt: self.system_prompt.clone(),
        }
    }
}

/// Stable contract: frozen execution config for reproducibility. Snapshot only freezes resolved execution contract.
/// Does NOT include api_key (runtime-injected from config for security).
/// Payload fields must match executor input 1:1 (command, args, env, headless_args, etc.).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSnapshotPayload {
    pub engine_id: String,
    pub profile_id: Option<String>,
    pub command: String,
    pub args: Vec<String>,
    pub env: std::collections::BTreeMap<String, String>,
    pub execution_mode: String,
    pub model: Option<String>,
    pub api_provider: Option<String>,
    pub api_base_url: Option<String>,
    pub supports_headless: bool,
    pub headless_args: Vec<String>,
    pub ready_signal: Option<String>,
    pub exit_command: Option<String>,
    pub exit_timeout_ms: Option<u64>,
    pub system_prompt: Option<String>,
}

/// Stable contract: snapshot record linking task to frozen payload. Do not add/remove fields without migration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSnapshot {
    pub id: String,
    pub task_id: String,
    pub engine_id: String,
    pub profile_id: Option<String>,
    pub payload_json: String,
    pub reason: String,
    pub created_at: String,
}

/// Stable contract: execution-to-snapshot binding. Every run must trace back to an ExecutionBinding.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionBinding {
    pub execution_id: String,
    pub task_id: String,
    pub snapshot_id: String,
    pub engine_id: String,
    pub profile_id: Option<String>,
    pub mode: String,
    pub source: String,
    pub created_at: String,
}



/// Resolve task runtime context from DB + config.
/// - If task has runtime_snapshot_id, loads from snapshot table (reproducibility)
/// - Else: reads task.engine_id, task.profile_id; fallback to first profile in engine.
pub fn resolve_task_runtime_context(
    db_path: &Path,
    task_id: &str,
    cfg: &AppConfig,
) -> Result<ResolvedRuntimeContext, CoreError> {
    resolve_task_runtime_context_inner(db_path, task_id, cfg)
}

fn resolve_task_runtime_context_inner(
    db_path: &Path,
    task_id: &str,
    cfg: &AppConfig,
) -> Result<ResolvedRuntimeContext, CoreError> {
    let task = crate::task::repository::get_task_record(db_path, task_id)?.ok_or_else(|| {
        CoreError::NotFound {
            resource: "task".to_string(),
            id: task_id.to_string(),
        }
    })?;

    let mut merged_settings = serde_json::Map::new();

    // 1. Workspace Settings
    if let Some(ref ws_id) = task.workspace_id {
        if let Ok(ws) = crate::infra::workspace_commands::get_workspace_by_id(db_path, ws_id) {
            if let Some(ws_json) = &ws.settings {
                if let Ok(serde_json::Value::Object(map)) = serde_json::from_str(ws_json) {
                    merged_settings.extend(map);
                }
            }
        }
    }

    // 2. Task Settings
    if let Some(task_json) = &task.settings {
        if let Ok(serde_json::Value::Object(map)) = serde_json::from_str(task_json) {
            merged_settings.extend(map);
        }
    }

    let merged_value = serde_json::Value::Object(merged_settings.clone());
    let cascading_settings: CascadingSettings =
        serde_json::from_value(merged_value).unwrap_or_default();

    let final_settings_str = if !merged_settings.is_empty() {
        Some(serde_json::Value::Object(merged_settings).to_string())
    } else {
        None
    };

    let system_prompt = cascading_settings.system_prompt;

    let binding = TaskRuntimeBinding {
        engine_id: task.engine_id.clone(),
        profile_id: task.profile_id.clone(),
        runtime_snapshot_id: task.runtime_snapshot_id.clone(),
    };

    // Prefer snapshot when available (reproducibility)
    if let Some(ref snapshot_id) = binding.runtime_snapshot_id {
        if !snapshot_id.trim().is_empty() {
            if let Ok(Some(payload)) =
                crate::storage::snapshot_repository::get_runtime_snapshot_payload(db_path, snapshot_id)
            {
                return Ok(ResolvedRuntimeContext {
                    task_id: task_id.to_string(),
                    engine_id: binding.engine_id.clone(),
                    profile_id: binding.profile_id.clone(),
                    snapshot_id: Some(snapshot_id.clone()),
                    command: payload.command,
                    args: payload.args,
                    env: payload.env,
                    execution_mode: payload.execution_mode,
                    model: payload.model,
                    api_provider: payload.api_provider,
                    api_base_url: payload.api_base_url,
                    api_key: cfg
                        .engines
                        .get(&binding.engine_id)
                        .and_then(|e| {
                            e.profiles
                                .get(binding.profile_id.as_deref().unwrap_or("default"))
                        })
                        .and_then(|p| p.api_key()),
                    supports_headless: payload.supports_headless,
                    headless_args: payload.headless_args,
                    ready_signal: payload.ready_signal,
                    exit_command: payload.exit_command,
                    exit_timeout_ms: payload.exit_timeout_ms,
                    resolved_from: RuntimeResolvedFrom::Snapshot,
                    settings: final_settings_str.clone(),
                    system_prompt: payload.system_prompt,
                });
            }
        }
    }

    // Fallback: resolve from config
    let engine = cfg
        .engines
        .get(&binding.engine_id)
        .ok_or_else(|| CoreError::NotFound {
            resource: "engine".to_string(),
            id: binding.engine_id.clone(),
        })?;

    // Task profile_id (from binding or migration backfill); else first profile in engine.
    let profile_id = binding
        .profile_id
        .clone()
        .filter(|s: &String| !s.is_empty())
        .or_else(|| engine.profiles.keys().next().cloned())
        .ok_or_else(|| CoreError::NotFound {
            resource: "profile".to_string(),
            id: "no profile in engine".to_string(),
        })?;

    let resolved_from = RuntimeResolvedFrom::LiveProfile;

    let profile = engine
        .profiles
        .get(&profile_id)
        .or_else(|| engine.profiles.values().next())
        .ok_or_else(|| CoreError::NotFound {
            resource: "profile".to_string(),
            id: "no profile in engine".to_string(),
        })?;

    Ok(ResolvedRuntimeContext {
        task_id: task_id.to_string(),
        engine_id: binding.engine_id,
        profile_id: Some(profile_id),
        snapshot_id: None,
        command: profile.command(),
        args: profile.args(),
        env: profile.env(),
        execution_mode: profile
            .execution_mode
            .clone()
            .unwrap_or_else(|| "cli".to_string()),
        model: Some(profile.model()),
        api_provider: profile.api_provider(),
        api_base_url: profile.api_base_url(),
        api_key: profile.api_key(),
        supports_headless: profile.supports_headless(),
        headless_args: profile.headless_args(),
        ready_signal: profile.ready_signal(),
        exit_command: profile.exit_command.clone(),
        exit_timeout_ms: profile.exit_timeout_ms,
        resolved_from,
        settings: final_settings_str,
        system_prompt,
    })
}



/// Resolve task runtime context using DB path.
pub fn resolve_task_runtime_context_with_db(
    db_path: &Path,
    task_id: &str,
    cfg: &AppConfig,
) -> Result<ResolvedRuntimeContext, CoreError> {
    resolve_task_runtime_context(db_path, task_id, cfg)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{EngineConfig, EngineProfile};
    use crate::storage::snapshot_repository;
    use std::collections::BTreeMap;
    use std::path::PathBuf;

    fn temp_db_path() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("test_maestro_state.db");
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
        let task_id = crate::task::state::create_task(
            &db_path,
            "Task",
            "",
            "eng1",
            "{}",
            Some("profile_b"),
            None,
            None,
        )
        .expect("create_task")
        .id;

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
            category: None,
            extra: BTreeMap::new(),
        };
        let mut engines = BTreeMap::new();
        engines.insert("eng1".to_string(), engine);
        let cfg = AppConfig {
            engines,
            ..Default::default()
        };

        let resolved = resolve_task_runtime_context(&db_path, &task_id, &cfg).expect("resolve");
        assert_eq!(resolved.engine_id, "eng1");
        assert_eq!(resolved.profile_id.as_deref(), Some("profile_b"));
    }

    #[test]
    fn resolve_falls_back_to_active_profile_when_task_profile_empty() {
        let (_dir, db_path) = temp_db_path();
        let task_id = crate::task::state::create_task(&db_path, "Task", "", "eng1", "{}", None, None, None)
            .expect("create_task")
            .id;

        let mut profiles = BTreeMap::new();
        profiles.insert("default".to_string(), mock_profile("default"));
        let engine = EngineConfig {
            id: "eng1".to_string(),
            plugin_type: "cli".to_string(),
            display_name: "Engine".to_string(),
            icon: "".to_string(),
            profiles: profiles.clone(),
            active_profile_id: "default".to_string(),
            category: None,
            extra: BTreeMap::new(),
        };
        let mut engines = BTreeMap::new();
        engines.insert("eng1".to_string(), engine);
        let cfg = AppConfig {
            engines,
            ..Default::default()
        };

        let resolved = resolve_task_runtime_context(&db_path, &task_id, &cfg).expect("resolve");
        assert_eq!(resolved.profile_id.as_deref(), Some("default"));
    }

    #[test]
    fn resolve_uses_snapshot_when_task_has_runtime_snapshot_id() {
        let (_dir, db_path) = temp_db_path();
        let task_id = crate::task::state::create_task(
            &db_path,
            "Task",
            "",
            "eng1",
            "{}",
            Some("profile_a"),
            None,
            None,
        )
        .expect("create_task")
        .id;

        // Create runtime snapshot (not profile_snapshot) - the authoritative execution config
        let snapshot_id = uuid::Uuid::new_v4().to_string();
        let payload = RuntimeSnapshotPayload {
            engine_id: "eng1".to_string(),
            profile_id: Some("profile_a".to_string()),
            command: "snap-cmd".to_string(),
            args: vec![],
            env: BTreeMap::new(),
            execution_mode: "cli".to_string(),
            model: Some("snapshot-model".to_string()),
            api_provider: None,
            api_base_url: None,
            supports_headless: false,
            headless_args: vec![],
            ready_signal: None,
            exit_command: None,
            exit_timeout_ms: None,
            system_prompt: None,
        };
        let payload_json = serde_json::to_string(&payload).expect("serialize payload");
        let snapshot = RuntimeSnapshot {
            id: snapshot_id.clone(),
            task_id: task_id.clone(),
            engine_id: "eng1".to_string(),
            profile_id: Some("profile_a".to_string()),
            payload_json,
            reason: "first_execution".to_string(),
            created_at: String::new(),
        };
        crate::storage::snapshot_repository::insert_runtime_snapshot(&db_path, &snapshot)
            .expect("insert_runtime_snapshot");
        crate::task::state::update_task_runtime_snapshot(&db_path, &task_id, Some(&snapshot_id))
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
            category: None,
            extra: BTreeMap::new(),
        };
        let mut engines = BTreeMap::new();
        engines.insert("eng1".to_string(), engine);
        let cfg = AppConfig {
            engines,
            ..Default::default()
        };

        let resolved = resolve_task_runtime_context(&db_path, &task_id, &cfg).expect("resolve");
        assert_eq!(resolved.profile_id.as_deref(), Some("profile_a"));
        assert_eq!(resolved.command, "snap-cmd");
        assert_eq!(resolved.model, Some("snapshot-model".to_string()));
        assert!(matches!(
            resolved.resolved_from,
            RuntimeResolvedFrom::Snapshot
        ));
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
            category: None,
            extra: BTreeMap::new(),
        };
        let mut engines = BTreeMap::new();
        engines.insert("eng1".to_string(), engine);
        let cfg = AppConfig {
            engines,
            ..Default::default()
        };

        let err = resolve_task_runtime_context(&db_path, "nonexistent", &cfg).unwrap_err();
        assert!(matches!(err, CoreError::NotFound { resource, .. } if resource == "task"));
    }
}
