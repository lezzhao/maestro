//! Workspace CRUD commands and SQLite persistence.
//! Workspaces are top-level containers that group tasks and bind a working directory.

use crate::core::error::CoreError;
use crate::task::state::maestro_db_path;
use serde::{Deserialize, Serialize};

// ── Types ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub name: String,
    /// If empty/None, workspace operates in Pure Chat mode.
    #[serde(default)]
    pub working_directory: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    // Workspace-level config overrides
    #[serde(default)]
    pub preferred_engine_id: Option<String>,
    #[serde(default)]
    pub preferred_profile_id: Option<String>,
    #[serde(default)]
    pub spec_provider: Option<String>,
    #[serde(default)]
    pub spec_mode: Option<String>,
    #[serde(default)]
    pub spec_target_ide: Option<String>,
    #[serde(default)]
    pub settings: Option<String>,
    /// Unix timestamp ms
    pub created_at: i64,
    /// Unix timestamp ms
    pub updated_at: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceCreateRequest {
    pub name: String,
    #[serde(default)]
    pub working_directory: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub preferred_engine_id: Option<String>,
    #[serde(default)]
    pub preferred_profile_id: Option<String>,
    #[serde(default)]
    pub spec_provider: Option<String>,
    #[serde(default)]
    pub spec_mode: Option<String>,
    #[serde(default)]
    pub spec_target_ide: Option<String>,
    #[serde(default)]
    pub settings: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceUpdateRequest {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub working_directory: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub preferred_engine_id: Option<String>,
    #[serde(default)]
    pub preferred_profile_id: Option<String>,
    #[serde(default)]
    pub spec_provider: Option<String>,
    #[serde(default)]
    pub spec_mode: Option<String>,
    #[serde(default)]
    pub spec_target_ide: Option<String>,
    #[serde(default)]
    pub settings: Option<String>,
}

// ── DB helpers (shared from task_repository) ──────────────────────────

use crate::task::repository::{db_err, sqlite_datetime_to_ms};

/// Ensure workspaces table exists.
pub fn ensure_workspace_table(conn: &rusqlite::Connection) -> Result<(), CoreError> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS workspaces (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            working_directory TEXT,
            icon TEXT,
            color TEXT,
            preferred_engine_id TEXT,
            preferred_profile_id TEXT,
            spec_provider TEXT,
            spec_mode TEXT,
            spec_target_ide TEXT,
            settings TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        "#,
    )
    .map_err(db_err)?;

    ensure_workspace_columns(conn)?;
    Ok(())
}

pub fn ensure_workspace_columns(conn: &rusqlite::Connection) -> Result<(), CoreError> {
    let columns = [
        ("icon", "TEXT"),
        ("color", "TEXT"),
        ("preferred_engine_id", "TEXT"),
        ("preferred_profile_id", "TEXT"),
        ("spec_provider", "TEXT"),
        ("spec_mode", "TEXT"),
        ("spec_target_ide", "TEXT"),
        ("settings", "TEXT"),
    ];
    for (name, ty) in columns {
        let count: i64 = conn
            .query_row(
                &format!(
                    "SELECT COUNT(*) FROM pragma_table_info('workspaces') WHERE name='{}'",
                    name
                ),
                [],
                |r| r.get(0),
            )
            .map_err(db_err)?;
        if count == 0 {
            conn.execute(
                &format!("ALTER TABLE workspaces ADD COLUMN {} {}", name, ty),
                [],
            )
            .map_err(db_err)?;
        }
    }
    Ok(())
}

/// Ensure tasks table has workspace_id column.
fn ensure_workspace_id_column(conn: &rusqlite::Connection) -> Result<(), CoreError> {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('tasks') WHERE name='workspace_id'",
            [],
            |r| r.get(0),
        )
        .map_err(db_err)?;
    if count == 0 {
        conn.execute("ALTER TABLE tasks ADD COLUMN workspace_id TEXT", [])
            .map_err(db_err)?;
    }
    Ok(())
}

/// Run workspace-related migrations on connection open.
pub fn ensure_workspace_schema(conn: &rusqlite::Connection) -> Result<(), CoreError> {
    ensure_workspace_table(conn)?;
    ensure_workspace_columns(conn)?;
    ensure_workspace_id_column(conn)?;
    Ok(())
}

// ── Repository ─────────────────────────────────────────────────────────

pub fn create_workspace(
    db_path: &std::path::Path,
    req: &WorkspaceCreateRequest,
) -> Result<Workspace, CoreError> {
    let conn = crate::task::repository::db_connection(db_path)?;
    crate::task::repository::ensure_tables(&conn)?;
    ensure_workspace_schema(&conn)?;

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now();
    let now_ms = now.timestamp_millis();
    let now_str = now.format("%Y-%m-%d %H:%M:%S").to_string();

    conn.execute(
        "INSERT INTO workspaces (id, name, working_directory, icon, color, preferred_engine_id, preferred_profile_id, spec_provider, spec_mode, spec_target_ide, settings, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        rusqlite::params![
            id,
            req.name,
            req.working_directory,
            req.icon,
            req.color,
            req.preferred_engine_id,
            req.preferred_profile_id,
            req.spec_provider,
            req.spec_mode,
            req.spec_target_ide,
            req.settings,
            now_str,
            now_str,
        ],
    )
    .map_err(db_err)?;

    Ok(Workspace {
        id,
        name: req.name.clone(),
        working_directory: req.working_directory.clone(),
        icon: req.icon.clone(),
        color: req.color.clone(),
        preferred_engine_id: req.preferred_engine_id.clone(),
        preferred_profile_id: req.preferred_profile_id.clone(),
        spec_provider: req.spec_provider.clone(),
        spec_mode: req.spec_mode.clone(),
        spec_target_ide: req.spec_target_ide.clone(),
        settings: req.settings.clone(),
        created_at: now_ms,
        updated_at: now_ms,
    })
}

pub fn list_workspaces(db_path: &std::path::Path) -> Result<Vec<Workspace>, CoreError> {
    let conn = crate::task::repository::db_connection(db_path)?;
    crate::task::repository::ensure_tables(&conn)?;
    ensure_workspace_schema(&conn)?;

    let mut stmt = conn
        .prepare(
            "SELECT id, name, working_directory, icon, color, preferred_engine_id, preferred_profile_id, spec_provider, spec_mode, spec_target_ide, settings, created_at, updated_at
             FROM workspaces ORDER BY updated_at DESC",
        )
        .map_err(db_err)?;

    let rows = stmt
        .query_map([], |row| {
            let created_at_str: String = row.get(11).unwrap_or_default();
            let updated_at_str: String = row.get(12).unwrap_or_default();
            Ok(Workspace {
                id: row.get(0)?,
                name: row.get(1)?,
                working_directory: row.get::<_, Option<String>>(2).ok().flatten(),
                icon: row.get::<_, Option<String>>(3).ok().flatten(),
                color: row.get::<_, Option<String>>(4).ok().flatten(),
                preferred_engine_id: row.get::<_, Option<String>>(5).ok().flatten(),
                preferred_profile_id: row.get::<_, Option<String>>(6).ok().flatten(),
                spec_provider: row.get::<_, Option<String>>(7).ok().flatten(),
                spec_mode: row.get::<_, Option<String>>(8).ok().flatten(),
                spec_target_ide: row.get::<_, Option<String>>(9).ok().flatten(),
                settings: row.get::<_, Option<String>>(10).ok().flatten(),
                created_at: sqlite_datetime_to_ms(&created_at_str),
                updated_at: sqlite_datetime_to_ms(&updated_at_str),
            })
        })
        .map_err(db_err)?;

    let mut workspaces = Vec::new();
    for row in rows {
        workspaces.push(row.map_err(db_err)?);
    }
    Ok(workspaces)
}

pub fn update_workspace(
    db_path: &std::path::Path,
    req: &WorkspaceUpdateRequest,
) -> Result<Workspace, CoreError> {
    let conn = crate::task::repository::db_connection(db_path)?;
    crate::task::repository::ensure_tables(&conn)?;
    ensure_workspace_schema(&conn)?;

    // Build dynamic SET clause for provided fields
    let mut sets = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref name) = req.name {
        sets.push("name = ?");
        params.push(Box::new(name.clone()));
    }
    if let Some(ref wd) = req.working_directory {
        sets.push("working_directory = ?");
        params.push(Box::new(wd.clone()));
    }
    if let Some(ref icon) = req.icon {
        sets.push("icon = ?");
        params.push(Box::new(icon.clone()));
    }
    if let Some(ref color) = req.color {
        sets.push("color = ?");
        params.push(Box::new(color.clone()));
    }
    if let Some(ref engine_id) = req.preferred_engine_id {
        sets.push("preferred_engine_id = ?");
        params.push(Box::new(engine_id.clone()));
    }
    if let Some(ref profile_id) = req.preferred_profile_id {
        sets.push("preferred_profile_id = ?");
        params.push(Box::new(profile_id.clone()));
    }
    if let Some(ref sp) = req.spec_provider {
        sets.push("spec_provider = ?");
        params.push(Box::new(sp.clone()));
    }
    if let Some(ref sm) = req.spec_mode {
        sets.push("spec_mode = ?");
        params.push(Box::new(sm.clone()));
    }
    if let Some(ref sti) = req.spec_target_ide {
        sets.push("spec_target_ide = ?");
        params.push(Box::new(sti.clone()));
    }
    if let Some(ref settings) = req.settings {
        sets.push("settings = ?");
        params.push(Box::new(settings.clone()));
    }

    sets.push("updated_at = CURRENT_TIMESTAMP");
    params.push(Box::new(req.id.clone()));

    let sql = format!("UPDATE workspaces SET {} WHERE id = ?", sets.join(", "));

    let params_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    conn.execute(&sql, params_refs.as_slice()).map_err(db_err)?;

    if conn.changes() == 0 {
        return Err(CoreError::NotFound {
            resource: "workspace".to_string(),
            id: req.id.clone(),
        });
    }

    get_workspace_by_id(db_path, &req.id)
}

pub fn get_workspace_by_id(db_path: &std::path::Path, id: &str) -> Result<Workspace, CoreError> {
    let conn = crate::task::repository::db_connection(db_path)?;
    ensure_workspace_schema(&conn)?;

    let mut stmt = conn
        .prepare(
            "SELECT id, name, working_directory, icon, color, preferred_engine_id, preferred_profile_id, spec_provider, spec_mode, spec_target_ide, settings, created_at, updated_at
             FROM workspaces WHERE id = ?1",
        )
        .map_err(db_err)?;

    let ws = stmt
        .query_row(rusqlite::params![id], |row| {
            let created_at_str: String = row.get(11).unwrap_or_default();
            let updated_at_str: String = row.get(12).unwrap_or_default();
            Ok(Workspace {
                id: row.get(0)?,
                name: row.get(1)?,
                working_directory: row.get::<_, Option<String>>(2).ok().flatten(),
                icon: row.get::<_, Option<String>>(3).ok().flatten(),
                color: row.get::<_, Option<String>>(4).ok().flatten(),
                preferred_engine_id: row.get::<_, Option<String>>(5).ok().flatten(),
                preferred_profile_id: row.get::<_, Option<String>>(6).ok().flatten(),
                spec_provider: row.get::<_, Option<String>>(7).ok().flatten(),
                spec_mode: row.get::<_, Option<String>>(8).ok().flatten(),
                spec_target_ide: row.get::<_, Option<String>>(9).ok().flatten(),
                settings: row.get::<_, Option<String>>(10).ok().flatten(),
                created_at: sqlite_datetime_to_ms(&created_at_str),
                updated_at: sqlite_datetime_to_ms(&updated_at_str),
            })
        })
        .map_err(db_err)?;

    Ok(ws)
}

pub fn delete_workspace(db_path: &std::path::Path, workspace_id: &str) -> Result<(), CoreError> {
    let conn = crate::task::repository::db_connection(db_path)?;
    crate::task::repository::ensure_tables(&conn)?;
    ensure_workspace_schema(&conn)?;

    conn.execute(
        "DELETE FROM workspaces WHERE id = ?1",
        rusqlite::params![workspace_id],
    )
    .map_err(db_err)?;

    if conn.changes() == 0 {
        return Err(CoreError::NotFound {
            resource: "workspace".to_string(),
            id: workspace_id.to_string(),
        });
    }

    // Clear workspace_id from associated tasks (don't delete tasks)
    conn.execute(
        "UPDATE tasks SET workspace_id = NULL WHERE workspace_id = ?1",
        rusqlite::params![workspace_id],
    )
    .map_err(db_err)?;

    Ok(())
}

// ── Tauri IPC Commands ─────────────────────────────────────────────────

#[tauri::command]
pub async fn workspace_create(
    app: tauri::AppHandle,
    request: WorkspaceCreateRequest,
) -> Result<Workspace, CoreError> {
    let db_path = maestro_db_path(&app)?;
    let ws = create_workspace(&db_path, &request)?;
    // Emit event so frontend can sync
    crate::agent_state::emit_state_update(
        Some(&app),
        crate::agent_state::AgentStateUpdate::WorkspaceCreated {
            workspace: ws.clone(),
        },
        None,
    );
    Ok(ws)
}

#[tauri::command]
pub async fn workspace_list(app: tauri::AppHandle) -> Result<Vec<Workspace>, CoreError> {
    let db_path = maestro_db_path(&app)?;
    list_workspaces(&db_path)
}

#[tauri::command]
pub async fn workspace_update(
    app: tauri::AppHandle,
    request: WorkspaceUpdateRequest,
) -> Result<Workspace, CoreError> {
    let db_path = maestro_db_path(&app)?;
    let ws = update_workspace(&db_path, &request)?;
    crate::agent_state::emit_state_update(
        Some(&app),
        crate::agent_state::AgentStateUpdate::WorkspaceUpdated {
            workspace: ws.clone(),
        },
        None,
    );
    Ok(ws)
}

#[tauri::command]
pub async fn workspace_delete(
    app: tauri::AppHandle,
    workspace_id: String,
) -> Result<(), CoreError> {
    let db_path = maestro_db_path(&app)?;
    delete_workspace(&db_path, &workspace_id)?;
    crate::agent_state::emit_state_update(
        Some(&app),
        crate::agent_state::AgentStateUpdate::WorkspaceDeleted { workspace_id },
        None,
    );
    Ok(())
}

// ── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_db_path() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("test_maestro_state.db");
        (dir, path)
    }

    #[test]
    fn workspace_create_and_list() {
        let (_dir, db_path) = temp_db_path();
        let req = WorkspaceCreateRequest {
            name: "My Project".to_string(),
            working_directory: Some("/Users/test/project".to_string()),
            icon: None,
            color: Some("#6366f1".to_string()),
            preferred_engine_id: Some("cursor".to_string()),
            preferred_profile_id: None,
            spec_provider: Some("maestro".to_string()),
            spec_mode: None,
            spec_target_ide: None,
            settings: None,
        };
        let ws = create_workspace(&db_path, &req).expect("create");
        assert_eq!(ws.name, "My Project");
        assert_eq!(ws.working_directory.as_deref(), Some("/Users/test/project"));
        assert_eq!(ws.preferred_engine_id.as_deref(), Some("cursor"));

        let list = list_workspaces(&db_path).expect("list");
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, ws.id);
    }

    #[test]
    fn workspace_update_partial() {
        let (_dir, db_path) = temp_db_path();
        let req = WorkspaceCreateRequest {
            name: "Original".to_string(),
            working_directory: None,
            icon: None,
            color: None,
            preferred_engine_id: None,
            preferred_profile_id: None,
            spec_provider: None,
            spec_mode: None,
            spec_target_ide: None,
            settings: None,
        };
        let ws = create_workspace(&db_path, &req).expect("create");

        let update = WorkspaceUpdateRequest {
            id: ws.id.clone(),
            name: Some("Updated".to_string()),
            working_directory: Some("/new/path".to_string()),
            icon: None,
            color: None,
            preferred_engine_id: None,
            preferred_profile_id: None,
            spec_provider: None,
            spec_mode: None,
            spec_target_ide: None,
            settings: None,
        };
        let updated = update_workspace(&db_path, &update).expect("update");
        assert_eq!(updated.name, "Updated");
        assert_eq!(updated.working_directory.as_deref(), Some("/new/path"));
    }

    #[test]
    fn workspace_delete_clears_task_association() {
        let (_dir, db_path) = temp_db_path();

        // Create workspace
        let req = WorkspaceCreateRequest {
            name: "ToDelete".to_string(),
            working_directory: None,
            icon: None,
            color: None,
            preferred_engine_id: None,
            preferred_profile_id: None,
            spec_provider: None,
            spec_mode: None,
            spec_target_ide: None,
            settings: None,
        };
        let ws = create_workspace(&db_path, &req).expect("create workspace");

        // Create a task associated with this workspace
        let task =
            crate::task::state::create_task(&db_path, "Task1", "", "cursor", "{}", None, None, None)
                .expect("create task");

        // Associate task with workspace
        let conn = crate::task::repository::db_connection(&db_path).expect("open db");
        conn.execute(
            "UPDATE tasks SET workspace_id = ?1 WHERE id = ?2",
            rusqlite::params![ws.id, task.id],
        )
        .expect("associate");
        drop(conn);

        // Delete workspace
        delete_workspace(&db_path, &ws.id).expect("delete workspace");

        // Task should still exist but workspace_id = NULL
        let conn = crate::task::repository::db_connection(&db_path).expect("open db");
        let ws_id: Option<String> = conn
            .query_row(
                "SELECT workspace_id FROM tasks WHERE id = ?1",
                rusqlite::params![task.id],
                |r| r.get(0),
            )
            .expect("query");
        assert!(ws_id.is_none());

        // Workspace should be gone
        let list = list_workspaces(&db_path).expect("list");
        assert!(list.is_empty());
    }

    #[test]
    fn workspace_delete_not_found() {
        let (_dir, db_path) = temp_db_path();
        // Ensure tables exist
        let conn = crate::task::repository::db_connection(&db_path).expect("open");
        crate::task::repository::ensure_tables(&conn).expect("tables");
        ensure_workspace_schema(&conn).expect("schema");
        drop(conn);

        let err = delete_workspace(&db_path, "nonexistent").unwrap_err();
        assert!(matches!(err, CoreError::NotFound { resource, .. } if resource == "workspace"));
    }
}
