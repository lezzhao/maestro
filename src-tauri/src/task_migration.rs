//! One-time migration: backfill profile_id for tasks with empty profile_id.
//! Required before removing engine.active_profile_id fallback. See docs/MIGRATION_FALLBACK_REMOVAL.md.

use crate::config::AppConfig;
use crate::core::error::CoreError;
use crate::task_repository;
use std::path::Path;

/// Backfill profile_id for all tasks that have empty profile_id.
/// Uses engine.active_profile_id or first profile from engine config.
/// Idempotent: safe to run multiple times.
pub fn migrate_backfill_task_profile_id(
    db_path: &Path,
    config: &AppConfig,
) -> Result<usize, CoreError> {
    let tasks = task_repository::list_tasks(db_path)?;
    let mut updated = 0;
    for task in tasks {
        let profile_id_empty = task
            .profile_id
            .as_ref()
            .map(|s| s.trim().is_empty())
            .unwrap_or(true);
        if !profile_id_empty {
            continue;
        }
        let engine = match config.engines.get(&task.engine_id) {
            Some(e) => e,
            None => continue,
        };
        let profile_id = if !engine.active_profile_id.is_empty()
            && engine.profiles.contains_key(&engine.active_profile_id)
        {
            engine.active_profile_id.clone()
        } else if let Some(pid) = engine.profiles.keys().next().cloned() {
            pid
        } else {
            continue;
        };
        task_repository::update_task_engine(db_path, &task.id, &task.engine_id, Some(&profile_id))?;
        updated += 1;
    }
    Ok(updated)
}
