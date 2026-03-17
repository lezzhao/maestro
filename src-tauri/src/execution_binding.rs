//! Execution preparation: the single entry for reproducible execution.
//!
//! All execution entries that produce run records MUST go through `prepare_execution` or
//! `prepare_execution_binding`. Flow: task binding -> resolved runtime -> runtime snapshot
//! -> execution binding -> run.
//!
//! Snapshot semantics: snapshot freezes the resolved execution contract only (RuntimeSnapshotPayload),
//! not a profile template. Reproducible execution uses runtime_snapshot exclusively.

use crate::config::AppConfig;
use crate::core::error::CoreError;
use crate::task_runtime::{
    resolve_task_runtime_context, ResolvedRuntimeContext, RuntimeSnapshot, RuntimeSnapshotPayload,
};
use crate::task_state::{self, bmad_db_path};
use tauri::AppHandle;

/// Ensures a runtime snapshot exists for the given task.
/// If it doesn't exist, resolves the live context and freezes it.
pub fn ensure_runtime_snapshot(
    app: &AppHandle,
    task_id: &str,
    config: &AppConfig,
) -> Result<String, CoreError> {
    let db_path = bmad_db_path(app).map_err(|e| CoreError::Io {
        message: format!("resolve db path failed: {e}"),
    })?;

    let binding = task_state::get_task_runtime_binding(&db_path, task_id)
        .map_err(|e| CoreError::Io {
            message: format!("get task binding failed: {e}"),
        })?
        .ok_or_else(|| CoreError::NotFound {
            resource: "task".to_string(),
            id: task_id.to_string(),
        })?;

    if let Some(snapshot_id) = binding.runtime_snapshot_id {
        if !snapshot_id.is_empty() {
            return Ok(snapshot_id);
        }
    }

    // Resolve context from config
    let ctx = resolve_task_runtime_context(&db_path, task_id, config)?;

    // Create snapshot payload
    let payload = RuntimeSnapshotPayload {
        engine_id: ctx.engine_id.clone(),
        profile_id: ctx.profile_id.clone(),
        command: ctx.command,
        args: ctx.args,
        env: ctx.env,
        execution_mode: ctx.execution_mode,
        model: ctx.model,
        api_provider: ctx.api_provider,
        api_base_url: ctx.api_base_url,
        supports_headless: ctx.supports_headless,
        ready_signal: ctx.ready_signal,
        exit_command: ctx.exit_command,
        exit_timeout_ms: ctx.exit_timeout_ms,
    };

    let payload_json = serde_json::to_string(&payload).map_err(|e| CoreError::Io {
        message: format!("serialize payload failed: {e}"),
    })?;

    let snapshot_id = uuid::Uuid::new_v4().to_string();
    let snapshot = RuntimeSnapshot {
        id: snapshot_id.clone(),
        task_id: task_id.to_string(),
        engine_id: ctx.engine_id.clone(),
        profile_id: ctx.profile_id.clone(),
        payload_json,
        reason: "first_execution".to_string(),
        created_at: "".to_string(),
    };

    crate::snapshot_repository::insert_runtime_snapshot(&db_path, &snapshot).map_err(|e| CoreError::Io {
        message: format!("insert snapshot failed: {e}"),
    })?;

    task_state::update_task_runtime_snapshot(&db_path, task_id, Some(&snapshot_id))
        .map_err(|e| CoreError::Io {
            message: format!("update task snapshot failed: {e}"),
        })?;

    Ok(snapshot_id)
}

/// Prepares execution binding using db_path directly. Used for testing.
#[cfg(test)]
pub fn prepare_execution_binding_with_path(
    db_path: &std::path::Path,
    execution_id: &str,
    task_id: &str,
    config: &AppConfig,
) -> Result<ResolvedRuntimeContext, CoreError> {
    let snapshot_id = ensure_runtime_snapshot_with_path(db_path, task_id, config)?;
    let ctx = resolve_task_runtime_context(db_path, task_id, config)?;
    let binding = crate::task_runtime::ExecutionBinding {
        execution_id: execution_id.to_string(),
        task_id: task_id.to_string(),
        snapshot_id,
        engine_id: ctx.engine_id.clone(),
        profile_id: ctx.profile_id.clone(),
        created_at: "".to_string(),
    };
    crate::execution_binding_repository::insert_execution_binding(db_path, &binding).map_err(
        |e| CoreError::Io {
            message: format!("insert execution binding failed: {e}"),
        },
    )?;
    Ok(ctx)
}

#[cfg(test)]
fn ensure_runtime_snapshot_with_path(
    db_path: &std::path::Path,
    task_id: &str,
    config: &AppConfig,
) -> Result<String, CoreError> {
    let binding = task_state::get_task_runtime_binding(db_path, task_id)
        .map_err(|e| CoreError::Io {
            message: format!("get task binding failed: {e}"),
        })?
        .ok_or_else(|| CoreError::NotFound {
            resource: "task".to_string(),
            id: task_id.to_string(),
        })?;

    if let Some(snapshot_id) = binding.runtime_snapshot_id {
        if !snapshot_id.is_empty() {
            return Ok(snapshot_id);
        }
    }

    let ctx = resolve_task_runtime_context(db_path, task_id, config)?;
    let payload = RuntimeSnapshotPayload {
        engine_id: ctx.engine_id.clone(),
        profile_id: ctx.profile_id.clone(),
        command: ctx.command,
        args: ctx.args,
        env: ctx.env,
        execution_mode: ctx.execution_mode,
        model: ctx.model,
        api_provider: ctx.api_provider,
        api_base_url: ctx.api_base_url,
        supports_headless: ctx.supports_headless,
        ready_signal: ctx.ready_signal,
        exit_command: ctx.exit_command,
        exit_timeout_ms: ctx.exit_timeout_ms,
    };
    let payload_json = serde_json::to_string(&payload).map_err(|e| CoreError::Io {
        message: format!("serialize payload failed: {e}"),
    })?;
    let snapshot_id = uuid::Uuid::new_v4().to_string();
    let snapshot = RuntimeSnapshot {
        id: snapshot_id.clone(),
        task_id: task_id.to_string(),
        engine_id: ctx.engine_id.clone(),
        profile_id: ctx.profile_id.clone(),
        payload_json,
        reason: "first_execution".to_string(),
        created_at: "".to_string(),
    };
    crate::snapshot_repository::insert_runtime_snapshot(db_path, &snapshot).map_err(|e| {
        CoreError::Io {
            message: format!("insert snapshot failed: {e}"),
        }
    })?;
    task_state::update_task_runtime_snapshot(db_path, task_id, Some(&snapshot_id))
        .map_err(|e| CoreError::Io {
            message: format!("update task snapshot failed: {e}"),
        })?;
    Ok(snapshot_id)
}

/// Unified execution preparation entry. Generates execution_id and prepares binding.
/// Returns (ResolvedRuntimeContext, execution_id) for callers to use in Execution records.
/// All execution entries must use this or prepare_execution_binding.
pub fn prepare_execution(
    app: &AppHandle,
    task_id: &str,
    source: &str,
    config: &AppConfig,
) -> Result<(ResolvedRuntimeContext, String), CoreError> {
    let execution_id = format!("{}-{}", source, uuid::Uuid::new_v4());
    let ctx = prepare_execution_binding(app, &execution_id, task_id, config)?;
    Ok((ctx, execution_id))
}

/// Like prepare_execution but with db_path for headless/testing. Returns (ctx, execution_id).
#[cfg(test)]
pub fn prepare_execution_with_path(
    db_path: &std::path::Path,
    task_id: &str,
    source: &str,
    config: &AppConfig,
) -> Result<(ResolvedRuntimeContext, String), CoreError> {
    let execution_id = format!("{}-{}", source, uuid::Uuid::new_v4());
    let ctx = prepare_execution_binding_with_path(db_path, &execution_id, task_id, config)?;
    Ok((ctx, execution_id))
}

/// Prepares the execution binding for a new run.
/// 1. Ensures snapshot exists.
/// 2. Records ExecutionBinding.
/// 3. Returns the resolved runtime context for execution.
pub fn prepare_execution_binding(
    app: &AppHandle,
    execution_id: &str,
    task_id: &str,
    config: &AppConfig,
) -> Result<ResolvedRuntimeContext, CoreError> {
    let db_path = bmad_db_path(app).map_err(|e| CoreError::Io {
        message: format!("resolve db path failed: {e}"),
    })?;

    // 1. Ensure snapshot
    let snapshot_id = ensure_runtime_snapshot(app, task_id, config)?;

    // 2. Resolve to get final ctx for execution (this will load from the snapshot since we just bound it)
    let ctx = resolve_task_runtime_context(&db_path, task_id, config)?;

    // 3. Insert Execution Binding
    let binding = crate::task_runtime::ExecutionBinding {
        execution_id: execution_id.to_string(),
        task_id: task_id.to_string(),
        snapshot_id,
        engine_id: ctx.engine_id.clone(),
        profile_id: ctx.profile_id.clone(),
        created_at: "".to_string(),
    };

    crate::execution_binding_repository::insert_execution_binding(&db_path, &binding).map_err(|e| CoreError::Io {
        message: format!("insert execution binding failed: {e}"),
    })?;

    Ok(ctx)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::AppConfig;
    use std::path::PathBuf;

    fn temp_db_path() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("test_bmad_state.db");
        (dir, path)
    }

    #[test]
    fn prepare_execution_binding_creates_snapshot_and_binding() {
        let (_dir, db_path) = temp_db_path();
        let cfg = AppConfig::default();
        let task_id = crate::task_state::create_task(&db_path, "Task", "", "cursor", "{}", None)
            .expect("create_task");

        let ctx = prepare_execution_binding_with_path(&db_path, "exec-1", &task_id, &cfg)
            .expect("prepare_execution_binding");

        assert_eq!(ctx.engine_id, "cursor");
        assert!(matches!(
            ctx.resolved_from,
            crate::task_runtime::RuntimeResolvedFrom::Snapshot
        ));

        let binding = crate::task_state::get_task_runtime_binding(&db_path, &task_id)
            .expect("get binding")
            .expect("binding exists");
        assert!(binding.runtime_snapshot_id.is_some());
    }

    #[test]
    fn prepare_execution_binding_resolved_context_from_snapshot() {
        let (_dir, db_path) = temp_db_path();
        let mut cfg = AppConfig::default();
        let task_id = crate::task_state::create_task(&db_path, "Task", "", "cursor", "{}", None)
            .expect("create_task");

        let profile = cfg.engines.get_mut("cursor").unwrap().profiles.get_mut("default").unwrap();
        profile.command = "original-cmd".to_string();

        let ctx1 =
            prepare_execution_binding_with_path(&db_path, "exec-1", &task_id, &cfg)
                .expect("first prepare");
        let snapshot_id = ctx1.snapshot_id.clone().expect("has snapshot");

        cfg.engines.get_mut("cursor").unwrap().profiles.get_mut("default").unwrap().command =
            "changed-cmd".to_string();

        let ctx2 =
            prepare_execution_binding_with_path(&db_path, "exec-2", &task_id, &cfg)
                .expect("second prepare");

        assert_eq!(
            ctx2.command, ctx1.command,
            "resolve should come from snapshot, not live config"
        );
        assert_eq!(ctx2.snapshot_id.as_deref(), Some(snapshot_id.as_str()));
    }

    #[test]
    fn contract_prepare_creates_binding() {
        let (_dir, db_path) = temp_db_path();
        let cfg = AppConfig::default();
        let task_id = crate::task_state::create_task(&db_path, "Task", "", "cursor", "{}", None)
            .expect("create_task");

        let ctx = prepare_execution_binding_with_path(&db_path, "exec-1", &task_id, &cfg)
            .expect("prepare");

        let binding = crate::task_state::get_task_runtime_binding(&db_path, &task_id)
            .expect("get binding")
            .expect("binding exists");
        assert_eq!(binding.engine_id, "cursor");
        assert!(binding.runtime_snapshot_id.is_some());
        assert_eq!(ctx.engine_id, binding.engine_id);
    }

    #[test]
    fn contract_resolved_context_matches_snapshot() {
        let (_dir, db_path) = temp_db_path();
        let mut cfg = AppConfig::default();
        let task_id = crate::task_state::create_task(&db_path, "Task", "", "cursor", "{}", None)
            .expect("create_task");

        cfg.engines
            .get_mut("cursor")
            .unwrap()
            .profiles
            .get_mut("default")
            .unwrap()
            .command = "frozen-cmd".to_string();

        let ctx = prepare_execution_binding_with_path(&db_path, "exec-1", &task_id, &cfg)
            .expect("prepare");
        let snapshot_id = ctx.snapshot_id.as_ref().expect("has snapshot");

        let payload = crate::snapshot_repository::get_runtime_snapshot_payload(&db_path, snapshot_id)
            .expect("get payload")
            .expect("payload exists");

        assert_eq!(ctx.command, payload.command);
        assert_eq!(ctx.args, payload.args);
        assert_eq!(ctx.execution_mode, payload.execution_mode);
    }

    #[test]
    fn contract_binding_change_invalidates_snapshot() {
        let (_dir, db_path) = temp_db_path();
        let cfg = AppConfig::default();
        let task_id = crate::task_state::create_task(&db_path, "Task", "", "cursor", "{}", None)
            .expect("create_task");

        let _ = prepare_execution_binding_with_path(&db_path, "exec-1", &task_id, &cfg)
            .expect("first prepare");

        let binding_before = crate::task_state::get_task_runtime_binding(&db_path, &task_id)
            .expect("get binding")
            .expect("binding exists");
        assert!(binding_before.runtime_snapshot_id.is_some());

        crate::task_state::update_task_runtime_snapshot(&db_path, &task_id, None)
            .expect("invalidate");

        let binding_after = crate::task_state::get_task_runtime_binding(&db_path, &task_id)
            .expect("get binding")
            .expect("binding exists");
        assert!(binding_after.runtime_snapshot_id.is_none());

        let mut cfg2 = AppConfig::default();
        cfg2.engines
            .get_mut("cursor")
            .unwrap()
            .profiles
            .get_mut("default")
            .unwrap()
            .command = "new-cmd".to_string();

        let ctx = crate::task_runtime::resolve_task_runtime_context(&db_path, &task_id, &cfg2)
            .expect("resolve");
        assert_eq!(ctx.command, "new-cmd");
    }

    #[test]
    fn prepare_execution_returns_valid_execution_id_and_creates_binding() {
        let (_dir, db_path) = temp_db_path();
        let cfg = AppConfig::default();
        let task_id = crate::task_state::create_task(&db_path, "Task", "", "cursor", "{}", None)
            .expect("create_task");

        let (ctx, execution_id) =
            prepare_execution_with_path(&db_path, &task_id, "chat_api", &cfg)
                .expect("prepare_execution");

        assert!(execution_id.starts_with("chat_api-"));
        assert_eq!(ctx.engine_id, "cursor");
        assert!(matches!(
            ctx.resolved_from,
            crate::task_runtime::RuntimeResolvedFrom::Snapshot
        ));

        let binding = crate::task_state::get_task_runtime_binding(&db_path, &task_id)
            .expect("get binding")
            .expect("binding exists");
        assert!(binding.runtime_snapshot_id.is_some());
    }
}
