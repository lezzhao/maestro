use serde::{Deserialize, Serialize};
use crate::core::error::CoreError;
use rusqlite::params;
use std::path::Path;
use super::mode::HarnessMode;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HarnessSession {
    pub id: String,
    pub task_id: String,
    pub current_mode: HarnessMode,
    pub strategic_plan: Option<String>,
    pub metadata_json: Option<String>,
}

pub fn db_err(e: impl std::fmt::Display) -> CoreError {
    CoreError::Db {
        message: e.to_string(),
    }
}

pub fn save_harness_session(
    db_path: &Path,
    session: &HarnessSession,
) -> Result<(), CoreError> {
    let conn = rusqlite::Connection::open(db_path).map_err(db_err)?;
    conn.execute(
        "INSERT INTO harness_sessions (id, task_id, current_mode, strategic_plan, metadata_json)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(id) DO UPDATE SET
            current_mode = excluded.current_mode,
            strategic_plan = excluded.strategic_plan,
            metadata_json = excluded.metadata_json,
            updated_at = CURRENT_TIMESTAMP",
        params![
            session.id,
            session.task_id,
            session.current_mode.as_str(),
            session.strategic_plan,
            session.metadata_json,
        ],
    )
    .map_err(db_err)?;
    Ok(())
}

pub fn get_harness_session_by_task(
    db_path: &Path,
    task_id: &str,
) -> Result<Option<HarnessSession>, CoreError> {
    let conn = rusqlite::Connection::open(db_path).map_err(db_err)?;
    let mut stmt = conn
        .prepare("SELECT id, task_id, current_mode, strategic_plan, metadata_json FROM harness_sessions WHERE task_id = ?1")
        .map_err(db_err)?;
    
    let mut rows = stmt.query(params![task_id]).map_err(db_err)?;
    
    if let Some(row) = rows.next().map_err(db_err)? {
        let mode_str: String = row.get(2).map_err(db_err)?;
        let current_mode = HarnessMode::from_str(&mode_str).unwrap_or_default();
        
        Ok(Some(HarnessSession {
            id: row.get(0).map_err(db_err)?,
            task_id: row.get(1).map_err(db_err)?,
            current_mode,
            strategic_plan: row.get(3).map_err(db_err)?,
            metadata_json: row.get(4).map_err(db_err)?,
        }))
    } else {
        Ok(None)
    }
}
