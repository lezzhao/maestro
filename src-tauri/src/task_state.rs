//! Task state machine (Logic to Rust).
//! States: BACKLOG -> PLANNING -> IN_PROGRESS -> CODE_REVIEW -> DONE

use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::Manager;
use std::process::Command;

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

/// Take git snapshot in project directory. Returns commit hash or None.
pub fn take_git_snapshot(project_path: &Path, task_id: &str, to_state: &str) -> Option<String> {
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
pub fn transition(
    db_path: &Path,
    project_path: &Path,
    task_id: &str,
    from_state: &str,
    event: &TaskEvent,
) -> Result<String, String> {
    let from = TaskState::from_str(from_state)
        .ok_or_else(|| format!("invalid from_state: {from_state}"))?;
    let to = valid_transition(from, event)
        .ok_or_else(|| format!("invalid transition: {} + {:?}", from_state, event))?;
    let to_str = to.as_str();

    let git_hash = take_git_snapshot(project_path, task_id, to_str);

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

/// Resolve bmad_state.db path. Tries app_data_dir then app_config_dir to align with tauri-plugin-sql.
fn bmad_db_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
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
pub struct TaskTransitionRequest {
    task_id: String,
    from_state: String,
    event_type: String,
    event_reason: Option<String>,
}

#[tauri::command]
pub async fn task_transition(
    app: tauri::AppHandle,
    request: TaskTransitionRequest,
) -> Result<String, String> {
    let event = TaskEvent::from_str(&request.event_type, request.event_reason)
        .ok_or_else(|| format!("invalid event: {}", request.event_type))?;
    let db_path = bmad_db_path(&app)?;
    let project_path = {
        let core = app.state::<crate::core::MaestroCore>();
        std::path::PathBuf::from(core.config.get().project.path.as_str())
    };
    transition(&db_path, &project_path, &request.task_id, &request.from_state, &event)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskGetStateRequest {
    task_id: String,
}

#[tauri::command]
pub async fn task_get_state(app: tauri::AppHandle, request: TaskGetStateRequest) -> Result<Option<String>, String> {
    let db_path = bmad_db_path(&app)?;
    get_task_state(&db_path, &request.task_id)
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
