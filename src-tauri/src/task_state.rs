//! Task state machine (Logic to Rust).
//! States: BACKLOG -> PLANNING -> IN_PROGRESS -> CODE_REVIEW -> DONE

use crate::agent_state::TaskRecordPayload;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;
use tauri::Manager;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TaskState {
    Backlog,
    Planning,
    InProgress,
    CodeReview,
    Done,
}

impl TaskState {
    pub fn as_str(&self) -> &'static str {
        match self {
            TaskState::Backlog => "BACKLOG",
            TaskState::Planning => "PLANNING",
            TaskState::InProgress => "IN_PROGRESS",
            TaskState::CodeReview => "CODE_REVIEW",
            TaskState::Done => "DONE",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "BACKLOG" => Some(TaskState::Backlog),
            "PLANNING" => Some(TaskState::Planning),
            "IN_PROGRESS" => Some(TaskState::InProgress),
            "CODE_REVIEW" => Some(TaskState::CodeReview),
            "DONE" => Some(TaskState::Done),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TaskEvent {
    StartPlanning,
    StartExecution,
    RequestReview,
    Approve,
    Reject { reason: String },
    Pause,
    AddTests,
}

impl TaskEvent {
    pub fn from_str(s: &str, reason: Option<String>) -> Option<Self> {
        match s {
            "START_PLANNING" => Some(TaskEvent::StartPlanning),
            "START_EXECUTION" => Some(TaskEvent::StartExecution),
            "REQUEST_REVIEW" => Some(TaskEvent::RequestReview),
            "APPROVE" => Some(TaskEvent::Approve),
            "REJECT" => Some(TaskEvent::Reject {
                reason: reason.unwrap_or_default(),
            }),
            "PAUSE" => Some(TaskEvent::Pause),
            "ADD_TESTS" => Some(TaskEvent::AddTests),
            _ => None,
        }
    }
}

/// Valid transitions: (from, event) -> to
fn valid_transition(from: TaskState, event: &TaskEvent) -> Option<TaskState> {
    match (from, event) {
        (TaskState::Backlog, TaskEvent::StartPlanning) => Some(TaskState::Planning),
        (TaskState::Planning, TaskEvent::StartExecution) => Some(TaskState::InProgress),
        (TaskState::Planning, TaskEvent::Pause) => Some(TaskState::Backlog),
        (TaskState::InProgress, TaskEvent::RequestReview) => Some(TaskState::CodeReview),
        (TaskState::InProgress, TaskEvent::Pause) => Some(TaskState::Backlog),
        (TaskState::CodeReview, TaskEvent::Approve) => Some(TaskState::Done),
        (TaskState::CodeReview, TaskEvent::Reject { .. }) => Some(TaskState::InProgress),
        _ => None,
    }
}

use crate::workspace_io::WorkspaceIo;

/// Take git snapshot in project directory. Returns commit hash or None.
pub fn take_git_snapshot(io: &WorkspaceIo, task_id: &str, to_state: &str) -> Option<String> {
    let project_path = io.root();
    if project_path.as_os_str().is_empty() || !project_path.exists() {
        return None;
    }
    let status = Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(project_path)
        .output()
        .ok()?;
    if status.stdout.is_empty() {
        return None;
    }
    let msg = format!("[bmad auto-snapshot] Task {} -> {}", task_id, to_state);
    let commit = Command::new("git")
        .args(["add", "."])
        .current_dir(project_path)
        .status()
        .ok()?;
    if !commit.success() {
        return None;
    }
    let commit = Command::new("git")
        .args(["commit", "-m", &msg])
        .current_dir(project_path)
        .output()
        .ok()?;
    if commit.status.code() != Some(0) {
        return None;
    }
    let hash = Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(project_path)
        .output()
        .ok()?;
    Some(String::from_utf8_lossy(&hash.stdout).trim().to_string())
}

/// Ensure tasks and state_transitions tables exist.
fn ensure_tables(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT NOT NULL,
            engine_id TEXT NOT NULL,
            current_state TEXT NOT NULL,
            workspace_boundary TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS state_transitions (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL,
            from_state TEXT NOT NULL,
            to_state TEXT NOT NULL,
            triggered_by TEXT NOT NULL,
            git_snapshot_hash TEXT,
            context_reasoning TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        "#,
    )
    .map_err(|e| format!("create tables failed: {e}"))?;
    Ok(())
}

/// Log transition and update task state. Returns new state or error.
/// When take_snapshot is true, runs git snapshot before persisting (policy-controlled).
pub fn transition(
    db_path: &Path,
    io: &WorkspaceIo,
    task_id: &str,
    from_state: &str,
    event: &TaskEvent,
    take_snapshot: bool,
) -> Result<String, String> {
    let from = TaskState::from_str(from_state)
        .ok_or_else(|| format!("invalid from_state: {from_state}"))?;
    let to = valid_transition(from, event)
        .ok_or_else(|| format!("invalid transition: {} + {:?}", from_state, event))?;
    let to_str = to.as_str();

    let git_hash = if take_snapshot {
        take_git_snapshot(io, task_id, to_str)
    } else {
        None
    };

    let conn = rusqlite::Connection::open(db_path).map_err(|e| format!("open db failed: {e}"))?;
    ensure_tables(&conn)?;

    let transition_id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO state_transitions (id, task_id, from_state, to_state, triggered_by, git_snapshot_hash, context_reasoning)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![
            transition_id,
            task_id,
            from_state,
            to_str,
            "system",
            git_hash.as_deref(),
            format!("Transitioned via {:?}", event),
        ],
    )
    .map_err(|e| format!("log transition failed: {e}"))?;

    conn.execute(
        "UPDATE tasks SET current_state = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
        rusqlite::params![to_str, task_id],
    )
    .map_err(|e| format!("update task state failed: {e}"))?;
    if conn.changes() == 0 {
        return Err(format!("task not found: {task_id}"));
    }

    Ok(to_str.to_string())
}

/// Update a task's engine_id in the database.
pub fn update_task_engine(db_path: &Path, task_id: &str, engine_id: &str) -> Result<(), String> {
    let conn = rusqlite::Connection::open(db_path).map_err(|e| format!("open db failed: {e}"))?;
    ensure_tables(&conn)?;
    conn.execute(
        "UPDATE tasks SET engine_id = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2",
        rusqlite::params![engine_id, task_id],
    )
    .map_err(|e| format!("update task engine failed: {e}"))?;
    if conn.changes() == 0 {
        return Err(format!("task not found: {task_id}"));
    }
    Ok(())
}

/// Delete a task from the database.
pub fn delete_task(db_path: &Path, task_id: &str) -> Result<(), String> {
    let conn = rusqlite::Connection::open(db_path).map_err(|e| format!("open db failed: {e}"))?;
    ensure_tables(&conn)?;
    conn.execute("DELETE FROM tasks WHERE id = ?1", rusqlite::params![task_id])
        .map_err(|e| format!("delete task failed: {e}"))?;
    if conn.changes() == 0 {
        return Err(format!("task not found: {task_id}"));
    }
    Ok(())
}

/// Create a new task in the database. Returns the created task id.
pub fn create_task(
    db_path: &Path,
    title: &str,
    description: &str,
    engine_id: &str,
    workspace_boundary: &str,
) -> Result<String, String> {
    let conn = rusqlite::Connection::open(db_path).map_err(|e| format!("open db failed: {e}"))?;
    ensure_tables(&conn)?;

    let id = uuid::Uuid::new_v4().to_string();
    let initial_state = TaskState::Backlog.as_str();

    conn.execute(
        "INSERT INTO tasks (id, title, description, engine_id, current_state, workspace_boundary) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![id, title, description, engine_id, initial_state, workspace_boundary],
    )
    .map_err(|e| format!("insert task failed: {e}"))?;

    Ok(id)
}

/// Resolve bmad_state.db path. Tries app_data_dir then app_config_dir to align with tauri-plugin-sql.
pub(crate) fn bmad_db_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let path_resolver = app.path();
    if let Ok(dir) = path_resolver.app_data_dir() {
        return Ok(dir.join("bmad_state.db"));
    }
    if let Ok(dir) = path_resolver.app_config_dir() {
        return Ok(dir.join("bmad_state.db"));
    }
    path_resolver
        .app_data_dir()
        .map(|d| d.join("bmad_state.db"))
        .map_err(|e| format!("app dir: {e}"))
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskCreateRequest {
    pub title: String,
    #[serde(default)]
    pub description: String,
    pub engine_id: String,
    #[serde(default)]
    pub workspace_boundary: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskCreateResult {
    pub id: String,
    pub title: String,
    pub description: String,
    pub engine_id: String,
    pub current_state: String,
    pub workspace_boundary: String,
}

#[tauri::command]
pub async fn task_create(app: tauri::AppHandle, request: TaskCreateRequest) -> Result<TaskCreateResult, String> {
    let core = app.state::<crate::core::MaestroCore>();
    core.task_create(&app, request)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskTransitionRequest {
    pub task_id: String,
    pub from_state: String,
    pub event_type: String,
    pub event_reason: Option<String>,
    /// When true (default), take git snapshot on transition. Policy-controlled.
    #[serde(default = "default_true")]
    pub take_snapshot: bool,
}

fn default_true() -> bool {
    true
}

#[tauri::command]
pub async fn task_transition(
    app: tauri::AppHandle,
    request: TaskTransitionRequest,
) -> Result<String, String> {
    let core = app.state::<crate::core::MaestroCore>();
    core.task_transition(&app, request)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskGetStateRequest {
    pub task_id: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskUpdateEngineRequest {
    pub task_id: String,
    pub engine_id: String,
}

#[tauri::command]
pub async fn task_update_engine(
    app: tauri::AppHandle,
    request: TaskUpdateEngineRequest,
) -> Result<(), String> {
    let core = app.state::<crate::core::MaestroCore>();
    core.task_update_engine(&app, request)
}

#[tauri::command]
pub async fn task_delete(app: tauri::AppHandle, task_id: String) -> Result<(), String> {
    let core = app.state::<crate::core::MaestroCore>();
    core.task_delete(&app, task_id)
}

#[tauri::command]
pub async fn task_list(app: tauri::AppHandle) -> Result<Vec<TaskRecordPayload>, String> {
    let core = app.state::<crate::core::MaestroCore>();
    core.task_list(&app)
}

#[tauri::command]
pub async fn task_get_state(app: tauri::AppHandle, request: TaskGetStateRequest) -> Result<Option<String>, String> {
    let core = app.state::<crate::core::MaestroCore>();
    core.task_get_state(&app, request)
}

/// List all tasks from DB.
pub fn list_tasks(db_path: &Path) -> Result<Vec<TaskRecordPayload>, String> {
    let conn = rusqlite::Connection::open(db_path).map_err(|e| format!("open db failed: {e}"))?;
    ensure_tables(&conn)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, title, description, engine_id, current_state, workspace_boundary, created_at, updated_at FROM tasks ORDER BY updated_at DESC",
        )
        .map_err(|e| format!("prepare failed: {e}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(TaskRecordPayload {
                id: row.get(0)?,
                title: row.get(1)?,
                description: row.get(2)?,
                engine_id: row.get(3)?,
                current_state: row.get(4)?,
                workspace_boundary: row.get(5)?,
                created_at: row.get::<_, String>(6).unwrap_or_default(),
                updated_at: row.get::<_, String>(7).unwrap_or_default(),
            })
        })
        .map_err(|e| format!("query failed: {e}"))?;
    let mut tasks = Vec::new();
    for row in rows {
        tasks.push(row.map_err(|e| format!("row failed: {e}"))?);
    }
    Ok(tasks)
}

/// Get current task state from DB.
pub fn get_task_state(db_path: &Path, task_id: &str) -> Result<Option<String>, String> {
    let conn = rusqlite::Connection::open(db_path).map_err(|e| format!("open db failed: {e}"))?;
    ensure_tables(&conn)?;
    let mut stmt = conn
        .prepare("SELECT current_state FROM tasks WHERE id = ?1")
        .map_err(|e| format!("prepare failed: {e}"))?;
    let mut rows = stmt
        .query(rusqlite::params![task_id])
        .map_err(|e| format!("query failed: {e}"))?;
    if let Some(row) = rows.next().map_err(|e| format!("row failed: {e}"))? {
        let s: String = row.get(0).map_err(|e| format!("get failed: {e}"))?;
        Ok(Some(s))
    } else {
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_db_path() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("test_bmad_state.db");
        (dir, path)
    }

    #[test]
    fn test_task_create_persists_engine_id() {
        let (_dir, db_path) = temp_db_path();
        let id = create_task(
            &db_path,
            "Test Task",
            "",
            "cursor",
            "{}",
        )
        .expect("create_task");
        let tasks = list_tasks(&db_path).expect("list_tasks");
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].id, id);
        assert_eq!(tasks[0].engine_id, "cursor");
    }

    #[test]
    fn test_task_update_engine_persists() {
        let (_dir, db_path) = temp_db_path();
        let id = create_task(&db_path, "Task", "", "cursor", "{}").expect("create_task");
        update_task_engine(&db_path, &id, "claude").expect("update_task_engine");
        let tasks = list_tasks(&db_path).expect("list_tasks");
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].engine_id, "claude");
    }

    #[test]
    fn test_task_list_returns_engine_id() {
        let (_dir, db_path) = temp_db_path();
        create_task(&db_path, "A", "", "engine_x", "{}").expect("create");
        create_task(&db_path, "B", "", "engine_y", "{}").expect("create");
        let tasks = list_tasks(&db_path).expect("list_tasks");
        assert_eq!(tasks.len(), 2);
        let engine_ids: Vec<&str> = tasks.iter().map(|t| t.engine_id.as_str()).collect();
        assert!(engine_ids.contains(&"engine_x"));
        assert!(engine_ids.contains(&"engine_y"));
    }

    #[test]
    fn test_update_task_engine_task_not_found() {
        let (_dir, db_path) = temp_db_path();
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        ensure_tables(&conn).unwrap();
        drop(conn);
        let err = update_task_engine(&db_path, "nonexistent", "cursor").unwrap_err();
        assert!(err.contains("task not found"));
    }
}
