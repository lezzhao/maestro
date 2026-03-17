//! Task runtime context: authoritative resolution of engine + profile for a task.
//! Provides the single source of truth for "which profile does this task run with".
//! When task has runtime_snapshot_id, uses snapshot for reproducibility; else resolves from config.
//!
//! Snapshot semantics: snapshot freezes the resolved execution contract only (RuntimeSnapshotPayload),
//! not a profile template copy. Reproducible execution reads from runtime_snapshot exclusively.

use crate::config::{AppConfig, EngineProfile};
use crate::core::error::CoreError;
use crate::task_state::{self, bmad_db_path};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::AppHandle;

/// Task runtime context: the authoritative binding of engine + profile for a task.
/// Reference-style in current phase (points to config, not a snapshot).
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskRuntimeContext {
    pub engine_id: String,
    pub profile_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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
}

/// Layer 2: Tracking metadata. Not part of execution input; used for audit and binding.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedRuntimeMetadata {
    pub task_id: String,
    pub engine_id: String,
    pub profile_id: Option<String>,
    pub snapshot_id: Option<String>,
    pub resolved_from: RuntimeResolvedFrom,
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
}

impl ResolvedRuntimeContext {
    /// Build from metadata + execution layers. Use this pattern for new code.
    pub fn from_layers(metadata: ResolvedRuntimeMetadata, execution: ResolvedExecutionConfig) -> Self {
        Self {
            task_id: metadata.task_id,
            engine_id: metadata.engine_id,
            profile_id: metadata.profile_id,
            snapshot_id: metadata.snapshot_id,
            command: execution.command,
            args: execution.args,
            env: execution.env,
            execution_mode: execution.execution_mode,
            model: execution.model,
            api_provider: execution.api_provider,
            api_base_url: execution.api_base_url,
            api_key: execution.api_key,
            supports_headless: execution.supports_headless,
            headless_args: execution.headless_args,
            ready_signal: execution.ready_signal,
            exit_command: execution.exit_command,
            exit_timeout_ms: execution.exit_timeout_ms,
            resolved_from: metadata.resolved_from,
        }
    }

    /// Extract execution config for snapshot freeze. Excludes api_key from frozen payload.
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
        }
    }

    /// Extract metadata for tracking.
    pub fn to_metadata(&self) -> ResolvedRuntimeMetadata {
        ResolvedRuntimeMetadata {
            task_id: self.task_id.clone(),
            engine_id: self.engine_id.clone(),
            profile_id: self.profile_id.clone(),
            snapshot_id: self.snapshot_id.clone(),
            resolved_from: self.resolved_from.clone(),
        }
    }
}

impl ResolvedExecutionConfig {
    /// Convert to RuntimeSnapshotPayload for freeze. api_key is excluded (runtime-injected only).
    pub fn to_snapshot_payload(&self, engine_id: &str, profile_id: Option<&str>) -> RuntimeSnapshotPayload {
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
    pub created_at: String,
}

/// Resolved runtime context with the actual profile for execution.
#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct ResolvedTaskRuntimeContext {
    pub engine_id: String,
    pub profile_id: String,
    pub profile: EngineProfile,
}

/// Resolve task runtime context from DB + config.
/// - If task has runtime_snapshot_id, loads from snapshot table (reproducibility)
/// - Else: reads task.engine_id, task.profile_id; fallback to engine.active_profile_id (migration-only)
/// - When FallbackProfile is hit, solidifies by writing profile_id back to task (except when called from ensure).
pub fn resolve_task_runtime_context(
    db_path: &Path,
    task_id: &str,
    cfg: &AppConfig,
) -> Result<ResolvedRuntimeContext, CoreError> {
    resolve_task_runtime_context_inner(db_path, task_id, cfg, true)
}

/// Like resolve_task_runtime_context but does not solidify on fallback. Used by ensure_runtime_snapshot.
pub(crate) fn resolve_task_runtime_context_no_solidify(
    db_path: &Path,
    task_id: &str,
    cfg: &AppConfig,
) -> Result<ResolvedRuntimeContext, CoreError> {
    resolve_task_runtime_context_inner(db_path, task_id, cfg, false)
}

fn resolve_task_runtime_context_inner(
    db_path: &Path,
    task_id: &str,
    cfg: &AppConfig,
    solidify_on_fallback: bool,
) -> Result<ResolvedRuntimeContext, CoreError> {
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
            if let Ok(Some(payload)) = crate::snapshot_repository::get_runtime_snapshot_payload(db_path, snapshot_id) {
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
                    api_key: cfg.engines.get(&binding.engine_id)
                        .and_then(|e| e.profiles.get(binding.profile_id.as_deref().unwrap_or("default")))
                        .and_then(|p| p.api_key()),
                    supports_headless: payload.supports_headless,
                    headless_args: payload.headless_args,
                    ready_signal: payload.ready_signal,
                    exit_command: payload.exit_command,
                    exit_timeout_ms: payload.exit_timeout_ms,
                    resolved_from: RuntimeResolvedFrom::Snapshot,
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

    // Prefer task binding; engine.active_profile_id is migration-only fallback.
    let profile_id = binding
        .profile_id
        .clone()
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

    let resolved_from = if binding.profile_id.is_some() {
        RuntimeResolvedFrom::LiveProfile
    } else {
        tracing::warn!(
            task_id = %task_id,
            engine_id = %binding.engine_id,
            profile_id = %profile_id,
            "migration fallback: task has no profile_id, using engine.active_profile_id"
        );
        if solidify_on_fallback {
            if let Err(e) = task_state::update_task_engine(db_path, task_id, &binding.engine_id, Some(&profile_id)) {
                tracing::warn!(task_id = %task_id, error = %e, "migration fallback: failed to solidify profile_id");
            }
        }
        RuntimeResolvedFrom::FallbackProfile
    };

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
        execution_mode: profile.execution_mode.clone().unwrap_or_else(|| "cli".to_string()),
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
    })
}

/// Create a profile snapshot and pin the task to it (for reproducibility).
/// Call at execution start when app and task_id are available.
#[allow(dead_code)]
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
    let snapshot_id = uuid::Uuid::new_v4().to_string();
    let payload = RuntimeSnapshotPayload {
        engine_id: engine_id.to_string(),
        profile_id: Some(profile_id.to_string()),
        command: profile.command(),
        args: profile.args(),
        env: profile.env(),
        execution_mode: profile.execution_mode.clone().unwrap_or_else(|| "cli".to_string()),
        model: Some(profile.model()),
        api_provider: profile.api_provider(),
        api_base_url: profile.api_base_url(),
        supports_headless: profile.supports_headless(),
        headless_args: profile.headless_args(),
        ready_signal: profile.ready_signal(),
        exit_command: profile.exit_command.clone(),
        exit_timeout_ms: profile.exit_timeout_ms,
    };
    let payload_json = serde_json::to_string(&payload).map_err(|e| CoreError::Io {
        message: format!("serialize payload failed: {e}"),
    })?;
    let snapshot = RuntimeSnapshot {
        id: snapshot_id.clone(),
        task_id: task_id.to_string(),
        engine_id: engine_id.to_string(),
        profile_id: Some(profile_id.to_string()),
        payload_json,
        reason: "manual_freeze".to_string(),
        created_at: "".to_string(), // Will be default by DB
    };
    crate::snapshot_repository::insert_runtime_snapshot(&db_path, &snapshot).map_err(|e| CoreError::Io {
        message: format!("insert snapshot failed: {e}"),
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
) -> Result<ResolvedRuntimeContext, CoreError> {
    let db_path = bmad_db_path(app).map_err(|e| CoreError::Io {
        message: format!("resolve db path failed: {e}"),
    })?;
    resolve_task_runtime_context(&db_path, task_id, cfg)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{EngineConfig, EngineProfile};
    use crate::snapshot_repository;
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
        assert_eq!(resolved.profile_id.as_deref(), Some("profile_b"));
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
        assert_eq!(resolved.profile_id.as_deref(), Some("default"));
    }

    #[test]
    fn resolve_uses_snapshot_when_task_has_runtime_snapshot_id() {
        let (_dir, db_path) = temp_db_path();
        let task_id = task_state::create_task(&db_path, "Task", "", "eng1", "{}", Some("profile_a"))
            .expect("create_task");

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
        };
        let payload_json =
            serde_json::to_string(&payload).expect("serialize payload");
        let snapshot = RuntimeSnapshot {
            id: snapshot_id.clone(),
            task_id: task_id.clone(),
            engine_id: "eng1".to_string(),
            profile_id: Some("profile_a".to_string()),
            payload_json,
            reason: "first_execution".to_string(),
            created_at: String::new(),
        };
        snapshot_repository::insert_runtime_snapshot(&db_path, &snapshot)
            .expect("insert_runtime_snapshot");
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
        assert_eq!(resolved.profile_id.as_deref(), Some("profile_a"));
        assert_eq!(resolved.command, "snap-cmd");
        assert_eq!(resolved.model, Some("snapshot-model".to_string()));
        assert!(matches!(resolved.resolved_from, RuntimeResolvedFrom::Snapshot));
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
