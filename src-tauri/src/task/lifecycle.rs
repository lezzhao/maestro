//! Task state machine and lifecycle transitions.
//! States: BACKLOG -> PLANNING -> IN_PROGRESS -> CODE_REVIEW -> DONE

use crate::core::error::CoreError;
use crate::infra::workspace_io::WorkspaceIo;
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
    Suspended,
}

impl TaskState {
    pub fn as_str(&self) -> &'static str {
        match self {
            TaskState::Backlog => "BACKLOG",
            TaskState::Planning => "PLANNING",
            TaskState::InProgress => "IN_PROGRESS",
            TaskState::CodeReview => "CODE_REVIEW",
            TaskState::Done => "DONE",
            TaskState::Suspended => "SUSPENDED",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "BACKLOG" => Some(TaskState::Backlog),
            "PLANNING" => Some(TaskState::Planning),
            "IN_PROGRESS" => Some(TaskState::InProgress),
            "CODE_REVIEW" => Some(TaskState::CodeReview),
            "DONE" => Some(TaskState::Done),
            "SUSPENDED" => Some(TaskState::Suspended),
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
    Suspend { reason: String },
    Resume,
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
            "SUSPEND" => Some(TaskEvent::Suspend {
                reason: reason.unwrap_or_default(),
            }),
            "RESUME" => Some(TaskEvent::Resume),
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
        (TaskState::InProgress, TaskEvent::Suspend { .. }) => Some(TaskState::Suspended),
        (TaskState::Suspended, TaskEvent::Resume) => Some(TaskState::InProgress),
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
    let msg = format!("[maestro auto-snapshot] Task {} -> {}", task_id, to_state);
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

/// Task transition transaction manager.
pub struct TaskTransaction<'a> {
    pub task_id: String,
    pub from_state: TaskState,
    pub event: TaskEvent,
    pub take_snapshot: bool,
    pub db_path: &'a Path,
    pub io: &'a WorkspaceIo,
}

impl<'a> TaskTransaction<'a> {
    pub fn new(
        db_path: &'a Path,
        io: &'a WorkspaceIo,
        task_id: &str,
        from_state: &str,
        event: TaskEvent,
        take_snapshot: bool,
    ) -> Result<Self, CoreError> {
        let from = TaskState::from_str(from_state).ok_or_else(|| CoreError::ValidationError {
            field: "from_state".to_string(),
            message: format!("invalid from_state: {from_state}"),
        })?;
        Ok(Self {
            task_id: task_id.to_string(),
            from_state: from,
            event,
            take_snapshot,
            db_path,
            io,
        })
    }

    pub fn execute(self) -> Result<TaskState, CoreError> {
        let to = valid_transition(self.from_state, &self.event).ok_or_else(|| {
            CoreError::ValidationError {
                field: "transition".to_string(),
                message: format!(
                    "invalid transition: {} + {:?}",
                    self.from_state.as_str(),
                    self.event
                ),
            }
        })?;
        let to_str = to.as_str();

        let git_hash = if self.take_snapshot {
            take_git_snapshot(self.io, &self.task_id, to_str)
        } else {
            None
        };

        let mut conn = crate::task::repository::db_connection(self.db_path).map_err(|e| {
            crate::core::error::CoreError::Db {
                message: e.to_string(),
            }
        })?;
        crate::task::repository::ensure_tables(&conn)?;

        let tx = conn.transaction().map_err(|e| CoreError::Db {
            message: format!("Failed to start transaction: {e}"),
        })?;

        let transition_id = uuid::Uuid::new_v4().to_string();
        crate::task::repository::insert_state_transition(
            &tx,
            &transition_id,
            &self.task_id,
            self.from_state.as_str(),
            to_str,
            "system",
            git_hash.as_deref(),
            &format!("Transitioned via {:?}", self.event),
        )?;

        crate::task::repository::update_task_current_state(&tx, &self.task_id, to_str)?;

        tx.commit().map_err(|e| CoreError::Db {
            message: format!("Failed to commit transaction: {e}"),
        })?;

        Ok(to)
    }
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
    let runner = TaskTransaction::new(
        db_path,
        io,
        task_id,
        from_state,
        event.clone(),
        take_snapshot,
    )?;
    let new_state = runner.execute()?;
    Ok(new_state.as_str().to_string())
}
