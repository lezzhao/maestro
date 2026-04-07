use crate::core::error::CoreError;
use crate::task::repository::db_err;
use std::path::Path;

/// Insert a new execution binding.
pub fn insert_execution_binding(
    db_path: &Path,
    binding: &crate::task::runtime::ExecutionBinding,
) -> Result<(), CoreError> {
    let conn = crate::task::repository::db_connection(db_path).map_err(crate::task::repository::db_err)?;
    crate::task::repository::ensure_tables(&conn)?;
    conn.execute(
        "INSERT INTO execution_bindings (execution_id, task_id, snapshot_id, engine_id, profile_id, mode, source, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![
            binding.execution_id,
            binding.task_id,
            binding.snapshot_id,
            binding.engine_id,
            binding.profile_id,
            binding.mode,
            binding.source,
            binding.created_at,
        ],
    )
    .map_err(db_err)?;
    Ok(())
}
