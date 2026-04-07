//! Task CRUD and schema for maestro_state.db.
//! All SQL for tasks and state_transitions tables lives here.

use crate::agent_state::TaskRecordPayload;
use crate::core::error::CoreError;
use chrono::NaiveDateTime;
use std::path::Path;

/// Parse SQLite DATETIME string ("YYYY-MM-DD HH:MM:SS") to Unix timestamp in milliseconds.
pub(crate) fn sqlite_datetime_to_ms(s: &str) -> i64 {
    if s.is_empty() {
        return 0;
    }
    NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S")
        .map(|dt| dt.and_utc().timestamp_millis())
        .unwrap_or(0)
}

pub(crate) fn db_err(e: impl std::fmt::Display) -> CoreError {
    CoreError::Db {
        message: e.to_string(),
    }
}

pub(crate) fn db_connection(db_path: &Path) -> Result<rusqlite::Connection, CoreError> {
    let conn = rusqlite::Connection::open(db_path).map_err(db_err)?;
    conn.pragma_update(None, "journal_mode", "WAL").map_err(db_err)?;
    conn.pragma_update(None, "synchronous", "NORMAL").map_err(db_err)?;
    conn.pragma_update(None, "busy_timeout", 5000).map_err(db_err)?;
    Ok(conn)
}

/// Runtime binding info for a task (engine, profile, optional snapshot).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskRuntimeBinding {
    pub engine_id: String,
    pub profile_id: Option<String>,
    pub runtime_snapshot_id: Option<String>,
}

pub fn ensure_tables(conn: &rusqlite::Connection) -> Result<(), CoreError> {
    crate::storage::migrations::run_migrations(conn)
}

/// Insert a state transition record.
#[allow(clippy::too_many_arguments)]
pub fn insert_state_transition(
    conn: &rusqlite::Connection,
    transition_id: &str,
    task_id: &str,
    from_state: &str,
    to_state: &str,
    triggered_by: &str,
    git_snapshot_hash: Option<&str>,
    context_reasoning: &str,
) -> Result<(), CoreError> {
    conn.execute(
        "INSERT INTO state_transitions (id, task_id, from_state, to_state, triggered_by, git_snapshot_hash, context_reasoning)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![
            transition_id,
            task_id,
            from_state,
            to_state,
            triggered_by,
            git_snapshot_hash,
            context_reasoning,
        ],
    )
    .map_err(db_err)?;
    Ok(())
}

/// Update task's current_state.
pub fn update_task_current_state(
    conn: &rusqlite::Connection,
    task_id: &str,
    to_state: &str,
) -> Result<(), CoreError> {
    conn.execute(
        "UPDATE tasks SET current_state = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
        rusqlite::params![to_state, task_id],
    )
    .map_err(db_err)?;
    if conn.changes() == 0 {
        return Err(CoreError::NotFound {
            resource: "task".to_string(),
            id: task_id.to_string(),
        });
    }
    Ok(())
}

/// Result of creating a task: id and timestamps in milliseconds.
pub struct CreateTaskResult {
    pub id: String,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

/// Create a new task in the database. Returns the created task id and timestamps.
#[allow(clippy::too_many_arguments)]
pub fn create_task(
    db_path: &Path,
    title: &str,
    description: &str,
    engine_id: &str,
    current_state: &str,
    workspace_boundary: &str,
    profile_id: Option<&str>,
    workspace_id: Option<&str>,
    settings: Option<&str>,
) -> Result<CreateTaskResult, CoreError> {
    let conn = db_connection(db_path)?;
    ensure_tables(&conn)?;

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now();
    let now_ms = now.timestamp_millis();
    let now_str = now.format("%Y-%m-%d %H:%M:%S").to_string();
    conn.execute(
        "INSERT INTO tasks (id, title, description, engine_id, current_state, workspace_boundary, profile_id, workspace_id, settings, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        rusqlite::params![id, title, description, engine_id, current_state, workspace_boundary, profile_id, workspace_id, settings, now_str, now_str],
    )
    .map_err(db_err)?;

    Ok(CreateTaskResult {
        id: id.clone(),
        created_at_ms: now_ms,
        updated_at_ms: now_ms,
    })
}

/// Update a task's engine_id and profile_id in the database.
/// Clears runtime_snapshot_id so task uses fresh config until next execution.
pub fn update_task_engine(
    db_path: &Path,
    task_id: &str,
    engine_id: &str,
    profile_id: Option<&str>,
) -> Result<(), CoreError> {
    let conn = db_connection(db_path)?;
    ensure_tables(&conn)?;
    conn.execute(
        "UPDATE tasks SET engine_id = ?1, profile_id = ?2, runtime_snapshot_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?3",
        rusqlite::params![engine_id, profile_id, task_id],
    )
    .map_err(db_err)?;
    if conn.changes() == 0 {
        return Err(CoreError::NotFound {
            resource: "task".to_string(),
            id: task_id.to_string(),
        });
    }
    Ok(())
}

/// Delete a task from the database.
pub fn delete_task(db_path: &Path, task_id: &str) -> Result<(), CoreError> {
    let conn = db_connection(db_path)?;
    ensure_tables(&conn)?;
    conn.execute(
        "DELETE FROM tasks WHERE id = ?1",
        rusqlite::params![task_id],
    )
    .map_err(db_err)?;
    if conn.changes() == 0 {
        return Err(CoreError::NotFound {
            resource: "task".to_string(),
            id: task_id.to_string(),
        });
    }
    Ok(())
}

/// Get task's runtime binding (engine_id, profile_id, runtime_snapshot_id).
pub fn get_task_runtime_binding(
    db_path: &Path,
    task_id: &str,
) -> Result<Option<TaskRuntimeBinding>, CoreError> {
    let conn = db_connection(db_path)?;
    ensure_tables(&conn)?;
    let mut stmt = conn
        .prepare("SELECT engine_id, profile_id, runtime_snapshot_id FROM tasks WHERE id = ?1")
        .map_err(db_err)?;
    let mut rows = stmt.query(rusqlite::params![task_id]).map_err(db_err)?;
    if let Some(row) = rows.next().map_err(db_err)? {
        let engine_id: String = row.get(0).map_err(db_err)?;
        let profile_id: Option<String> = row.get::<_, Option<String>>(1).ok().flatten();
        let runtime_snapshot_id: Option<String> = row.get::<_, Option<String>>(2).ok().flatten();
        Ok(Some(TaskRuntimeBinding {
            engine_id,
            profile_id,
            runtime_snapshot_id,
        }))
    } else {
        Ok(None)
    }
}

/// Update task's runtime_snapshot_id.
pub fn update_task_runtime_snapshot(
    db_path: &Path,
    task_id: &str,
    snapshot_id: Option<&str>,
) -> Result<(), CoreError> {
    let conn = db_connection(db_path)?;
    ensure_tables(&conn)?;
    conn.execute(
        "UPDATE tasks SET runtime_snapshot_id = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
        rusqlite::params![snapshot_id, task_id],
    )
    .map_err(db_err)?;
    if conn.changes() == 0 {
        return Err(CoreError::NotFound {
            resource: "task".to_string(),
            id: task_id.to_string(),
        });
    }
    Ok(())
}

// get_task_by_id removed: use get_task_record instead (identical functionality).

/// List all tasks from DB.
pub fn list_tasks(db_path: &Path) -> Result<Vec<TaskRecordPayload>, CoreError> {
    let conn = db_connection(db_path)?;
    ensure_tables(&conn)?;
    let mut stmt = conn
        .prepare(
            r#"SELECT id, title, description, engine_id, current_state, workspace_boundary, profile_id, workspace_id, settings, runtime_snapshot_id, created_at, updated_at FROM tasks ORDER BY updated_at DESC"#,
        )
        .map_err(db_err)?;
    let rows = stmt
        .query_map([], |row| {
            let created_at_str: String = row.get(10).unwrap_or_default();
            let updated_at_str: String = row.get(11).unwrap_or_default();
            Ok(TaskRecordPayload {
                id: row.get(0)?,
                title: row.get(1)?,
                description: row.get(2)?,
                engine_id: row.get(3)?,
                current_state: row.get(4)?,
                workspace_boundary: row.get(5)?,
                profile_id: row.get::<_, Option<String>>(6).ok().flatten(),
                workspace_id: row.get::<_, Option<String>>(7).ok().flatten(),
                settings: row.get::<_, Option<String>>(8).ok().flatten(),
                runtime_snapshot_id: row.get::<_, Option<String>>(9).ok().flatten(),
                created_at: sqlite_datetime_to_ms(&created_at_str),
                updated_at: sqlite_datetime_to_ms(&updated_at_str),
            })
        })
        .map_err(db_err)?;
    let mut tasks = Vec::new();
    for row in rows {
        tasks.push(row.map_err(db_err)?);
    }
    Ok(tasks)
}

/// Get current task state from DB.
pub fn get_task_state(db_path: &Path, task_id: &str) -> Result<Option<String>, CoreError> {
    let conn = db_connection(db_path)?;
    ensure_tables(&conn)?;
    let mut stmt = conn
        .prepare("SELECT current_state FROM tasks WHERE id = ?1")
        .map_err(db_err)?;
    let mut rows = stmt.query(rusqlite::params![task_id]).map_err(db_err)?;
    if let Some(row) = rows.next().map_err(db_err)? {
        let s: String = row.get(0).map_err(db_err)?;
        Ok(Some(s))
    } else {
        Ok(None)
    }
}

pub fn get_task_record(
    db_path: &Path,
    task_id: &str,
) -> Result<Option<TaskRecordPayload>, CoreError> {
    let conn = db_connection(db_path)?;
    ensure_tables(&conn)?;

    let mut stmt = conn
        .prepare(
            "SELECT id, title, description, engine_id, current_state, workspace_boundary, profile_id, workspace_id, settings, runtime_snapshot_id, created_at, updated_at
             FROM tasks WHERE id = ?1",
        )
        .map_err(db_err)?;

    let row = stmt.query_row(rusqlite::params![task_id], |row| {
        let created_at_str: String = row.get(10).unwrap_or_default();
        let updated_at_str: String = row.get(11).unwrap_or_default();
        Ok(TaskRecordPayload {
            id: row.get(0)?,
            title: row.get(1)?,
            description: row.get(2)?,
            engine_id: row.get(3)?,
            current_state: row.get(4)?,
            workspace_boundary: row.get(5)?,
            profile_id: row.get(6)?,
            workspace_id: row.get(7)?,
            settings: row.get(8)?,
            runtime_snapshot_id: row.get(9)?,
            created_at: sqlite_datetime_to_ms(&created_at_str),
            updated_at: sqlite_datetime_to_ms(&updated_at_str),
        })
    });

    match row {
        Ok(t) => Ok(Some(t)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(db_err(e)),
    }
}

pub fn update_task(
    db_path: &Path,
    req: &crate::task::state::TaskUpdateRequest,
) -> Result<(), CoreError> {
    let conn = db_connection(db_path)?;
    ensure_tables(&conn)?;

    let mut sets = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref title) = req.title {
        sets.push("title = ?");
        params.push(Box::new(title.clone()));
    }
    if let Some(ref description) = req.description {
        sets.push("description = ?");
        params.push(Box::new(description.clone()));
    }
    if let Some(ref engine_id) = req.engine_id {
        sets.push("engine_id = ?");
        params.push(Box::new(engine_id.clone()));
    }
    if let Some(ref profile_id) = req.profile_id {
        sets.push("profile_id = ?");
        params.push(Box::new(profile_id.clone()));
    }
    if let Some(ref settings) = req.settings {
        sets.push("settings = ?");
        params.push(Box::new(settings.clone()));
    }
    if let Some(ref workspace_id) = req.workspace_id {
        sets.push("workspace_id = ?");
        params.push(Box::new(workspace_id.clone()));
    }

    if sets.is_empty() {
        return Ok(());
    }

    sets.push(r#"updated_at = CURRENT_TIMESTAMP"#);
    params.push(Box::new(req.id.clone()));

    let sql = format!(r#"UPDATE tasks SET {} WHERE id = ?"#, sets.join(", "));
    let params_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();

    conn.execute(&sql, params_refs.as_slice()).map_err(db_err)?;
    Ok(())
}

/// Get the most recent assistant message ID for a specific task's active conversation.
pub fn get_latest_assistant_message_id(db_path: &Path, task_id: &str) -> Result<Option<String>, CoreError> {
    let conn = db_connection(db_path)?;
    ensure_tables(&conn)?;

    let mut stmt = conn.prepare(
        "SELECT m.id FROM conversation_messages m
         JOIN conversations c ON m.conversation_id = c.id
         WHERE c.task_id = ?1 AND m.role = 'assistant'
         ORDER BY m.timestamp DESC LIMIT 1"
    ).map_err(db_err)?;

    let mut rows = stmt.query(rusqlite::params![task_id]).map_err(db_err)?;
    if let Some(row) = rows.next().map_err(db_err)? {
        let id: String = row.get(0).map_err(db_err)?;
        Ok(Some(id))
    } else {
        Ok(None)
    }
}
