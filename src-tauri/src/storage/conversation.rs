use crate::agent_state::PersistedMessagePayload;
use crate::core::error::CoreError;
use crate::task::repository::{db_err, sqlite_datetime_to_ms};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Arc;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationRecord {
    pub id: String,
    pub task_id: Option<String>,
    pub title: String,
    pub engine_id: String,
    pub profile_id: Option<String>,
    pub message_count: i32,
    pub summary: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

pub fn create_conversation(
    db_path: &Path,
    task_id: Option<&str>,
    title: &str,
    engine_id: &str,
    profile_id: Option<&str>,
) -> Result<String, CoreError> {
    let conn = crate::task::repository::db_connection(db_path)?;

    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    conn.execute(
        "INSERT INTO conversations (id, task_id, title, engine_id, profile_id, created_at, updated_at) 
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![id, task_id, title, engine_id, profile_id, now, now],
    )
    .map_err(db_err)?;

    Ok(id)
}

fn row_to_conversation_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<ConversationRecord> {
    let created_at_str: String = row.get(7)?;
    let updated_at_str: String = row.get(8)?;
    Ok(ConversationRecord {
        id: row.get(0)?,
        task_id: row.get(1)?,
        title: row.get(2)?,
        engine_id: row.get(3)?,
        profile_id: row.get(4)?,
        message_count: row.get(5)?,
        summary: row.get(6)?,
        created_at: sqlite_datetime_to_ms(&created_at_str),
        updated_at: sqlite_datetime_to_ms(&updated_at_str),
    })
}

pub fn list_conversations(
    db_path: &Path,
    task_id: Option<&str>,
) -> Result<Vec<ConversationRecord>, CoreError> {
    let conn = crate::task::repository::db_connection(db_path)?;

    let (sql, params): (&str, Box<dyn rusqlite::types::ToSql>) = if let Some(tid) = task_id {
        ("SELECT id, task_id, title, engine_id, profile_id, message_count, summary, created_at, updated_at 
          FROM conversations WHERE task_id = ?1 ORDER BY updated_at DESC",
         Box::new(tid.to_string()))
    } else {
        ("SELECT id, task_id, title, engine_id, profile_id, message_count, summary, created_at, updated_at 
          FROM conversations ORDER BY updated_at DESC",
         Box::new(rusqlite::types::Null))
    };

    let mut stmt = conn.prepare(sql).map_err(db_err)?;
    let params_slice: &[&dyn rusqlite::types::ToSql] = if task_id.is_some() {
        &[params.as_ref()]
    } else {
        &[]
    };

    let rows = stmt
        .query_map(params_slice, row_to_conversation_record)
        .map_err(db_err)?;

    let mut results = Vec::new();
    for row in rows {
        results.push(row.map_err(db_err)?);
    }
    Ok(results)
}

pub fn append_message(
    db_path: &Path,
    conversation_id: &str,
    msg: &PersistedMessagePayload,
) -> Result<(), CoreError> {
    let conn = crate::task::repository::db_connection(db_path)?;

    let meta_json = msg.meta.as_ref().map(|v| v.to_string());
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    conn.execute(
        "INSERT INTO conversation_messages (id, conversation_id, role, content, timestamp, status, meta) 
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![msg.id, conversation_id, msg.role, msg.content, now, msg.status, meta_json],
    ).map_err(db_err)?;

    // Update conversation metadata
    conn.execute(
        "UPDATE conversations SET message_count = message_count + 1, updated_at = ?1 WHERE id = ?2",
        rusqlite::params![now, conversation_id],
    )
    .map_err(db_err)?;

    Ok(())
}

fn row_to_message_payload(row: &rusqlite::Row<'_>) -> rusqlite::Result<PersistedMessagePayload> {
    let ts_str: String = row.get(3)?;
    let meta_str: Option<String> = row.get(5)?;
    let meta = meta_str.and_then(|s| serde_json::from_str(&s).ok());

    Ok(PersistedMessagePayload {
        id: row.get(0)?,
        role: row.get(1)?,
        content: row.get(2)?,
        timestamp: Some(sqlite_datetime_to_ms(&ts_str)),
        status: row.get(4)?,
        attachments: None,
        meta,
    })
}

pub fn load_conversation_messages(
    db_path: &Path,
    conversation_id: &str,
) -> Result<Vec<PersistedMessagePayload>, CoreError> {
    let conn = crate::task::repository::db_connection(db_path)?;

    let mut stmt = conn
        .prepare(
            "SELECT id, role, content, timestamp, status, meta 
         FROM conversation_messages WHERE conversation_id = ?1 ORDER BY timestamp ASC",
        )
        .map_err(db_err)?;

    let rows = stmt
        .query_map(rusqlite::params![conversation_id], row_to_message_payload)
        .map_err(db_err)?;

    let mut messages = Vec::new();
    for row in rows {
        messages.push(row.map_err(db_err)?);
    }
    Ok(messages)
}

pub fn delete_conversation(db_path: &Path, id: &str) -> Result<(), CoreError> {
    let conn = crate::task::repository::db_connection(db_path)?;
    conn.execute(
        "DELETE FROM conversations WHERE id = ?1",
        rusqlite::params![id],
    )
    .map_err(db_err)?;
    Ok(())
}

pub fn update_conversation_title(db_path: &Path, id: &str, title: &str) -> Result<(), CoreError> {
    let conn = crate::task::repository::db_connection(db_path)?;
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    conn.execute(
        "UPDATE conversations SET title = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![title, now, id],
    )
    .map_err(db_err)?;
    Ok(())
}

// Tauri Command Handlers

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationCreateRequest {
    pub task_id: Option<String>,
    pub title: String,
    pub engine_id: String,
    pub profile_id: Option<String>,
}

#[tauri::command]
pub async fn conversation_create(
    core: tauri::State<'_, Arc<crate::core::MaestroCore>>,
    request: ConversationCreateRequest,
) -> Result<String, CoreError> {
    let db_path = &core.state_db_path;
    create_conversation(
        db_path,
        request.task_id.as_deref(),
        &request.title,
        &request.engine_id,
        request.profile_id.as_deref(),
    )
}

#[tauri::command]
pub async fn conversation_list(
    core: tauri::State<'_, Arc<crate::core::MaestroCore>>,
    task_id: Option<String>,
) -> Result<Vec<ConversationRecord>, CoreError> {
    let db_path = &core.state_db_path;
    list_conversations(db_path, task_id.as_deref())
}

#[tauri::command]
pub async fn conversation_load_messages(
    core: tauri::State<'_, Arc<crate::core::MaestroCore>>,
    conversation_id: String,
) -> Result<Vec<PersistedMessagePayload>, CoreError> {
    let db_path = &core.state_db_path;
    load_conversation_messages(db_path, &conversation_id)
}

#[tauri::command]
pub async fn conversation_delete(
    core: tauri::State<'_, Arc<crate::core::MaestroCore>>,
    conversation_id: String,
) -> Result<(), CoreError> {
    let db_path = &core.state_db_path;
    delete_conversation(db_path, &conversation_id)
}

#[tauri::command]
pub async fn conversation_update_title(
    core: tauri::State<'_, Arc<crate::core::MaestroCore>>,
    conversation_id: String,
    title: String,
) -> Result<(), CoreError> {
    let db_path = &core.state_db_path;
    update_conversation_title(db_path, &conversation_id, &title)
}
#[tauri::command]
pub async fn conversation_derive_title_heuristic(
    core: tauri::State<'_, Arc<crate::core::MaestroCore>>,
    conversation_id: String,
) -> Result<String, CoreError> {
    let db_path = &core.state_db_path;
    let messages = load_conversation_messages(db_path, &conversation_id)?;

    if messages.is_empty() {
        return Ok("New Chat".to_string());
    }

    // Prepare a prompt for titling
    let first_user_msg = messages
        .iter()
        .find(|m| m.role == "user")
        .map(|m| m.content.as_str())
        .unwrap_or("");
    if first_user_msg.is_empty() {
        return Ok("New Chat".to_string());
    }

    // For now, a simple heuristic: first 20-30 chars or first line
    let mut title = first_user_msg
        .lines()
        .next()
        .unwrap_or("")
        .trim()
        .to_string();
    if title.len() > 40 {
        title = format!("{}...", &title[..37]);
    }

    if title.is_empty() {
        title = "New Chat".to_string();
    }

    update_conversation_title(&db_path, &conversation_id, &title)?;
    Ok(title)
}
