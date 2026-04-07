use crate::core::error::CoreError;
use crate::task::repository::db_err;
use std::path::Path;

/// Insert a new runtime snapshot into DB.
pub fn insert_runtime_snapshot(
    db_path: &Path,
    snapshot: &crate::task::runtime::RuntimeSnapshot,
) -> Result<(), CoreError> {
    let conn = crate::task::repository::db_connection(db_path).map_err(crate::task::repository::db_err)?;
    crate::task::repository::ensure_tables(&conn)?;
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
    .map_err(db_err)?;
    Ok(())
}

/// Get a runtime snapshot payload by id.
pub fn get_runtime_snapshot_payload(
    db_path: &Path,
    snapshot_id: &str,
) -> Result<Option<crate::task::runtime::RuntimeSnapshotPayload>, CoreError> {
    let conn = crate::task::repository::db_connection(db_path).map_err(crate::task::repository::db_err)?;
    crate::task::repository::ensure_tables(&conn)?;
    let mut stmt = conn
        .prepare("SELECT payload_json FROM runtime_snapshots WHERE id = ?1")
        .map_err(db_err)?;
    let mut rows = stmt.query(rusqlite::params![snapshot_id]).map_err(db_err)?;
    if let Some(row) = rows.next().map_err(db_err)? {
        let json: String = row.get(0).map_err(db_err)?;
        let payload: crate::task::runtime::RuntimeSnapshotPayload = serde_json::from_str(&json)
            .map_err(|e| CoreError::Serialization {
                message: e.to_string(),
            })?;
        Ok(Some(payload))
    } else {
        Ok(None)
    }
}
