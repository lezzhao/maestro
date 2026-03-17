use std::path::Path;

/// Insert a new execution binding.
pub fn insert_execution_binding(
    db_path: &Path,
    binding: &crate::task_runtime::ExecutionBinding,
) -> Result<(), String> {
    let conn = rusqlite::Connection::open(db_path).map_err(|e| format!("open db failed: {e}"))?;
    crate::task_repository::ensure_tables(&conn)?;
    conn.execute(
        "INSERT INTO execution_bindings (execution_id, task_id, snapshot_id, engine_id, profile_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            binding.execution_id,
            binding.task_id,
            binding.snapshot_id,
            binding.engine_id,
            binding.profile_id,
            binding.created_at,
        ],
    )
    .map_err(|e| format!("insert execution binding failed: {e}"))?;
    Ok(())
}
