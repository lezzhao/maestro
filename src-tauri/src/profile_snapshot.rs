//! Profile snapshot: immutable copy of EngineProfile for reproducibility and audit.
//!
//! LEGACY: Do not use for new execution. Use runtime_snapshot (snapshot_repository) only.
//! All reproducible execution should read from RuntimeSnapshotPayload via snapshot_repository.

use crate::config::EngineProfile;
use rusqlite::params;
use std::path::Path;

#[allow(dead_code)]
const TABLE_DDL: &str = r#"
CREATE TABLE IF NOT EXISTS profile_snapshots (
    id TEXT PRIMARY KEY,
    engine_id TEXT NOT NULL,
    profile_id TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
"#;

#[allow(dead_code)]
fn ensure_table(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute_batch(TABLE_DDL)
        .map_err(|e| format!("create profile_snapshots table failed: {e}"))?;
    Ok(())
}

/// Create a snapshot of the given profile. Returns the snapshot id.
#[allow(dead_code)]
pub fn create_snapshot(
    db_path: &Path,
    engine_id: &str,
    profile_id: &str,
    profile: &EngineProfile,
) -> Result<String, String> {
    let conn = rusqlite::Connection::open(db_path).map_err(|e| format!("open db failed: {e}"))?;
    ensure_table(&conn)?;

    let id = uuid::Uuid::new_v4().to_string();
    let snapshot_json =
        serde_json::to_string(profile).map_err(|e| format!("serialize profile failed: {e}"))?;

    conn.execute(
        "INSERT INTO profile_snapshots (id, engine_id, profile_id, snapshot_json) VALUES (?1, ?2, ?3, ?4)",
        params![id, engine_id, profile_id, snapshot_json],
    )
    .map_err(|e| format!("insert snapshot failed: {e}"))?;

    Ok(id)
}

/// Get a profile snapshot by id. Returns None if not found or invalid.
#[allow(dead_code)]
pub fn get_snapshot(db_path: &Path, snapshot_id: &str) -> Result<Option<EngineProfile>, String> {
    let conn = rusqlite::Connection::open(db_path).map_err(|e| format!("open db failed: {e}"))?;
    ensure_table(&conn)?;

    let mut stmt = conn
        .prepare("SELECT snapshot_json FROM profile_snapshots WHERE id = ?1")
        .map_err(|e| format!("prepare failed: {e}"))?;
    let mut rows = stmt
        .query(params![snapshot_id])
        .map_err(|e| format!("query failed: {e}"))?;

    if let Some(row) = rows.next().map_err(|e| format!("row failed: {e}"))? {
        let json: String = row.get(0).map_err(|e| format!("get failed: {e}"))?;
        let profile =
            serde_json::from_str(&json).map_err(|e| format!("deserialize snapshot failed: {e}"))?;
        Ok(Some(profile))
    } else {
        Ok(None)
    }
}
