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
    pub metadata: Option<String>, // JSON metadata for skills etc.
    pub created_at: i64,
}

pub fn create_memory(
    db_path: &Path,
    task_id: Option<&str>,
    content: &str,
    category: &str,
    metadata: Option<&str>,
) -> Result<String, CoreError> {
    let conn = crate::task::repository::db_connection(db_path)?;
    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    conn.execute(
        "INSERT INTO memories (id, task_id, content, category, metadata, created_at, updated_at) 
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![id, task_id, content, category, metadata, now, now],
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
        ("SELECT id, task_id, content, category, importance, metadata, created_at FROM memories WHERE task_id = ?1 OR task_id IS NULL ORDER BY created_at DESC", 
         Box::new(tid.to_string()))
    } else {
        ("SELECT id, task_id, content, category, importance, metadata, created_at FROM memories WHERE task_id IS NULL ORDER BY created_at DESC",
         Box::new(rusqlite::types::Null))
    };

    let mut stmt = conn.prepare(sql).map_err(db_err)?;
    let params_slice: &[&dyn rusqlite::types::ToSql] = if task_id.is_some() {
        &[params.as_ref()]
    } else {
        &[]
    };

    let rows = stmt.query_map(params_slice, |row| {
        let ts_str: String = row.get(6)?;
        Ok(MemoryEntry {
            id: row.get(0)?,
            task_id: row.get(1)?,
            content: row.get(2)?,
            category: row.get(3)?,
            importance: row.get(4)?,
            metadata: row.get(5)?,
            created_at: crate::task::repository::sqlite_datetime_to_ms(&ts_str),
        })
    }).map_err(db_err)?;

    let mut results = Vec::new();
    for row in rows {
        results.push(row.map_err(db_err)?);
    }
    Ok(results)
}

pub fn delete_memory(db_path: &Path, id: &str) -> Result<(), CoreError> {
    let conn = crate::task::repository::db_connection(db_path)?;
    conn.execute("DELETE FROM memories WHERE id = ?1", [id]).map_err(db_err)?;
    Ok(())
}

// Memory RAG: Retrieval with scoring and usage tracking
pub fn recall_memories(
    db_path: &Path,
    query: &str,
    limit: usize
) -> Result<String, CoreError> {
    let all = list_memories(db_path, None)?;
    
    // Tokenize query into keywords (split on whitespace and common delimiters)
    let keywords: Vec<String> = query
        .to_lowercase()
        .split(|c: char| c.is_whitespace() || c == ',' || c == '.' || c == '?' || c == '!')
        .filter(|w| w.len() >= 2)
        .map(|w| w.to_string())
        .collect();

    if keywords.is_empty() {
        return Ok(String::new());
    }

    // Score each memory by keyword coverage + usage_count boost
    let mut scored: Vec<(&MemoryEntry, f64)> = all.iter()
        .filter_map(|m| {
            let content_lower = m.content.to_lowercase();
            let matched_keywords = keywords.iter()
                .filter(|kw| content_lower.contains(kw.as_str()))
                .count();
            if matched_keywords == 0 {
                return None;
            }
            // Score = keyword_coverage (0.0-1.0) + usage_boost (log scale)
            let keyword_score = matched_keywords as f64 / keywords.len() as f64;
            let usage_boost = (m.importance.max(0) as f64 + 1.0).ln() * 0.1;
            Some((m, keyword_score + usage_boost))
        })
        .collect();

    // Sort by score descending
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(limit);

    // Auto-increment usage_count for recalled memories
    for (entry, _) in &scored {
        let _ = increment_usage(db_path, &entry.id);
    }

    let result = scored.iter()
        .map(|(m, _)| format!("- [{}] {}", m.category, m.content))
        .collect::<Vec<_>>()
        .join("\n");
    
    Ok(result)
}

/// Increment usage_count and update last_used_at for a recalled memory.
pub fn increment_usage(db_path: &Path, memory_id: &str) -> Result<(), CoreError> {
    let conn = crate::task::repository::db_connection(db_path)?;
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    conn.execute(
        "UPDATE memories SET usage_count = COALESCE(usage_count, 0) + 1, last_used_at = ?1 WHERE id = ?2",
        rusqlite::params![now, memory_id],
    ).map_err(db_err)?;
    Ok(())
}

