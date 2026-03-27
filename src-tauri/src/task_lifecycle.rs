//! Task state machine and lifecycle transitions.
//! States: BACKLOG -> PLANNING -> IN_PROGRESS -> CODE_REVIEW -> DONE

use crate::core::error::CoreError;
use crate::workspace_io::WorkspaceIo;
use serde::{Deserialize, Serialize};
use std::path::Path;
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
pub fn valid_transition(from: TaskState, event: &TaskEvent) -> Option<TaskState> {
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

/// Log transition and update task state. Returns new state or error.
/// When take_snapshot is true, runs git snapshot before persisting (policy-controlled).
pub fn transition(
    db_path: &Path,
    io: &WorkspaceIo,
    task_id: &str,
    from_state: &str,
    event: &TaskEvent,
    take_snapshot: bool,
) -> Result<String, CoreError> {
    let from = TaskState::from_str(from_state).ok_or_else(|| CoreError::ValidationError {
        field: "from_state".to_string(),
        message: format!("invalid from_state: {from_state}"),
    })?;
    let to = valid_transition(from, event).ok_or_else(|| CoreError::ValidationError {
        field: "transition".to_string(),
        message: format!("invalid transition: {} + {:?}", from_state, event),
    })?;
    let to_str = to.as_str();

    let git_hash = if take_snapshot {
        take_git_snapshot(io, task_id, to_str)
    } else {
        None
    };

    let conn = rusqlite::Connection::open(db_path).map_err(|e| CoreError::Db {
        message: format!("open db failed: {e}"),
    })?;
    crate::task_repository::ensure_tables(&conn)?;

    let transition_id = uuid::Uuid::new_v4().to_string();
    crate::task_repository::insert_state_transition(
        &conn,
        &transition_id,
        task_id,
        from_state,
        to_str,
        "system",
        git_hash.as_deref(),
        &format!("Transitioned via {:?}", event),
    )?;

    crate::task_repository::update_task_current_state(&conn, task_id, to_str)?;

    Ok(to_str.to_string())
}
