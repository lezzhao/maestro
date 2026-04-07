use crate::core::error::CoreError;
use crate::task::repository::db_err;
use serde::{Deserialize, Serialize};
use std::path::Path;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MemoryEntry {
    pub id: String,
    pub task_id: Option<String>,
    pub content: String,
    pub category: String,
    pub importance: i32,
    pub created_at: i64,
}

pub fn create_memory(
    db_path: &Path,
    task_id: Option<&str>,
    content: &str,
    category: &str,
) -> Result<String, CoreError> {
    let conn = crate::task::repository::db_connection(db_path)?;
    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    conn.execute(
        "INSERT INTO memories (id, task_id, content, category, created_at, updated_at) 
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![id, task_id, content, category, now, now],
    )
    .map_err(db_err)?;

    Ok(id)
}

pub fn list_memories(
    db_path: &Path,
    task_id: Option<&str>,
) -> Result<Vec<MemoryEntry>, CoreError> {
    let conn = crate::task::repository::db_connection(db_path)?;
    let (sql, params): (&str, Box<dyn rusqlite::types::ToSql>) = if let Some(tid) = task_id {
        ("SELECT id, task_id, content, category, importance, created_at FROM memories WHERE task_id = ?1 OR task_id IS NULL ORDER BY created_at DESC", 
         Box::new(tid.to_string()))
    } else {
        ("SELECT id, task_id, content, category, importance, created_at FROM memories WHERE task_id IS NULL ORDER BY created_at DESC",
         Box::new(rusqlite::types::Null))
    };

    let mut stmt = conn.prepare(sql).map_err(db_err)?;
    let params_slice: &[&dyn rusqlite::types::ToSql] = if task_id.is_some() {
        &[params.as_ref()]
    } else {
        &[]
    };

    let rows = stmt.query_map(params_slice, |row| {
        let ts_str: String = row.get(5)?;
        Ok(MemoryEntry {
            id: row.get(0)?,
            task_id: row.get(1)?,
            content: row.get(2)?,
            category: row.get(3)?,
            importance: row.get(4)?,
            created_at: crate::task::repository::sqlite_datetime_to_ms(&ts_str),
        })
    }).map_err(db_err)?;

    let mut results = Vec::new();
    for row in rows {
        results.push(row.map_err(db_err)?);
    }
    Ok(results)
}

#[allow(dead_code)]
pub fn delete_memory(db_path: &Path, id: &str) -> Result<(), CoreError> {
    let conn = crate::task::repository::db_connection(db_path)?;
    conn.execute("DELETE FROM memories WHERE id = ?1", [id]).map_err(db_err)?;
    Ok(())
}

// Memory RAG: Retrieval
pub fn recall_memories(
    db_path: &Path,
    query: &str,
    limit: usize
) -> Result<String, CoreError> {
    let all = list_memories(db_path, None)?; // Basic MVP: list all global memories
    // For now, very simple simple fuzzy match or just return recent ones
    // Real implementation would use vector search (Phase 2.3+ extension)
    let filtered = all.iter()
        .filter(|m| m.content.to_lowercase().contains(&query.to_lowercase()))
        .take(limit)
        .map(|m| format!("- [{}] {}", m.category, m.content))
        .collect::<Vec<_>>()
        .join("\n");
    
    Ok(filtered)
}
