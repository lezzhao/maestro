use crate::config::AppConfig;
use crate::core::error::CoreError;
use std::path::Path;

/// Migration 1: Backfill profile_id for all tasks.
pub fn migrate(db_path: &Path, config: &AppConfig) -> Result<usize, CoreError> {
    let tasks = crate::task::repository::list_tasks(db_path)?;
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
        crate::task::repository::update_task_engine(db_path, &task.id, &task.engine_id, Some(&profile_id))?;
        updated += 1;
    }
    Ok(updated)
}
