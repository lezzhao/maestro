use std::path::Path;

/// Insert a new runtime snapshot into DB.
pub fn insert_runtime_snapshot(
    db_path: &Path,
    snapshot: &crate::task_runtime::RuntimeSnapshot,
) -> Result<(), String> {
    let conn = rusqlite::Connection::open(db_path).map_err(|e| format!("open db failed: {e}"))?;
    crate::task_repository::ensure_tables(&conn)?;
    conn.execute(
        "INSERT INTO runtime_snapshots (id, task_id, engine_id, profile_id, payload_json, reason, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![
            snapshot.id,
            snapshot.task_id,
            snapshot.engine_id,
            snapshot.profile_id,
            snapshot.payload_json,
            snapshot.reason,
            snapshot.created_at,
        ],
    )
    .map_err(|e| format!("insert runtime snapshot failed: {e}"))?;
    Ok(())
}

/// Get a runtime snapshot payload by id.
pub fn get_runtime_snapshot_payload(
    db_path: &Path,
    snapshot_id: &str,
) -> Result<Option<crate::task_runtime::RuntimeSnapshotPayload>, String> {
    let conn = rusqlite::Connection::open(db_path).map_err(|e| format!("open db failed: {e}"))?;
    crate::task_repository::ensure_tables(&conn)?;
    let mut stmt = conn
        .prepare("SELECT payload_json FROM runtime_snapshots WHERE id = ?1")
        .map_err(|e| format!("prepare failed: {e}"))?;
    let mut rows = stmt
        .query(rusqlite::params![snapshot_id])
        .map_err(|e| format!("query failed: {e}"))?;
    if let Some(row) = rows.next().map_err(|e| format!("row failed: {e}"))? {
        let json: String = row.get(0).map_err(|e| format!("get failed: {e}"))?;
        let payload: crate::task_runtime::RuntimeSnapshotPayload =
            serde_json::from_str(&json).map_err(|e| format!("deserialize failed: {e}"))?;
        Ok(Some(payload))
    } else {
        Ok(None)
    }
}
