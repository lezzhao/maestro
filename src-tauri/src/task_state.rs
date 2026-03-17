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

/// Update a task's engine_id and profile_id in the database.
/// Clears runtime_snapshot_id so task uses fresh config until next execution.
pub fn update_task_engine(
    db_path: &Path,
    task_id: &str,
    engine_id: &str,
    profile_id: Option<&str>,
) -> Result<(), String> {
    crate::task_repository::update_task_engine(db_path, task_id, engine_id, profile_id)
}

/// Delete a task from the database.
pub fn delete_task(db_path: &Path, task_id: &str) -> Result<(), String> {
    crate::task_repository::delete_task(db_path, task_id)
}

/// Create a new task in the database. Returns the created task id.
/// profile_id: when None, caller should resolve from engine's active_profile_id before calling.
pub fn create_task(
    db_path: &Path,
    title: &str,
    description: &str,
    engine_id: &str,
    workspace_boundary: &str,
    profile_id: Option<&str>,
) -> Result<String, String> {
    let initial_state = TaskState::Backlog.as_str();
    crate::task_repository::create_task(
        db_path,
        title,
        description,
        engine_id,
        initial_state,
        workspace_boundary,
        profile_id,
    )
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
    #[serde(default)]
    pub profile_id: Option<String>,
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
    pub profile_id: Option<String>,
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
pub struct TaskGetRuntimeContextRequest {
    pub task_id: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskGetRuntimeBindingRequest {
    pub task_id: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskRefreshRuntimeSnapshotRequest {
    pub task_id: String,
}

#[tauri::command]
pub async fn task_get_runtime_context(
    app: tauri::AppHandle,
    request: TaskGetRuntimeContextRequest,
) -> Result<crate::task_runtime::ResolvedRuntimeContext, String> {
    let core = app.state::<crate::core::MaestroCore>();
    let cfg = core.config.get();
    crate::task_runtime::resolve_task_runtime_context_for_app(&app, &request.task_id, &cfg)
        .map_err(|e| format!("resolve context failed: {:?}", e))
}

#[tauri::command]
pub async fn task_get_runtime_binding(
    app: tauri::AppHandle,
    request: TaskGetRuntimeBindingRequest,
) -> Result<Option<TaskRuntimeBinding>, String> {
    let db_path = bmad_db_path(&app)?;
    get_task_runtime_binding(&db_path, &request.task_id)
}

#[tauri::command]
pub async fn task_refresh_runtime_snapshot(
    app: tauri::AppHandle,
    request: TaskRefreshRuntimeSnapshotRequest,
) -> Result<(), String> {
    crate::task_runtime_service::invalidate_runtime_snapshot(&app, &request.task_id)?;
    let core = app.state::<crate::core::MaestroCore>();
    let cfg = core.config.get();
    let _ = crate::execution_binding::ensure_runtime_snapshot(&app, &request.task_id, &cfg)
        .map_err(|e| format!("refresh snapshot failed: {:?}", e))?;
    
    // Broadcast refreshed binding and context
    let db_path = bmad_db_path(&app)?;
    if let Ok(Some(binding)) = get_task_runtime_binding(&db_path, &request.task_id) {
        crate::agent_state::emit_state_update(
            Some(&app),
            crate::agent_state::AgentStateUpdate::TaskRuntimeBindingChanged {
                task_id: request.task_id.clone(),
                binding,
            },
        );
    }
    if let Ok(ctx) = crate::task_runtime::resolve_task_runtime_context_for_app(&app, &request.task_id, &cfg) {
        crate::agent_state::emit_state_update(
            Some(&app),
            crate::agent_state::AgentStateUpdate::TaskRuntimeContextResolved {
                task_id: request.task_id.clone(),
                context: ctx,
            },
        );
    }
    Ok(())
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskUpdateRuntimeBindingRequest {
    pub task_id: String,
    pub engine_id: String,
    #[serde(default)]
    pub profile_id: Option<String>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskSwitchRuntimeBindingRequest {
    pub task_id: String,
    pub engine_id: String,
    pub session_id: Option<String>,
    #[serde(default)]
    pub profile_id: Option<String>,
}

#[tauri::command]
pub async fn task_switch_runtime_binding(
    app: tauri::AppHandle,
    request: TaskSwitchRuntimeBindingRequest,
) -> Result<(), String> {
    let core = app.state::<crate::core::MaestroCore>();
    core.task_switch_runtime_binding(&app, request)
}

#[tauri::command]
pub async fn task_update_runtime_binding(
    app: tauri::AppHandle,
    request: TaskUpdateRuntimeBindingRequest,
) -> Result<(), String> {
    let core = app.state::<crate::core::MaestroCore>();
    core.task_update_runtime_binding(&app, request)
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

/// Re-export for API compatibility.
pub use crate::task_repository::TaskRuntimeBinding;

/// Get task's runtime binding (engine_id, profile_id, runtime_snapshot_id).
pub fn get_task_runtime_binding(
    db_path: &Path,
    task_id: &str,
) -> Result<Option<TaskRuntimeBinding>, String> {
    crate::task_repository::get_task_runtime_binding(db_path, task_id)
}

/// Update task's runtime_snapshot_id.
pub fn update_task_runtime_snapshot(
    db_path: &Path,
    task_id: &str,
    snapshot_id: Option<&str>,
) -> Result<(), String> {
    crate::task_repository::update_task_runtime_snapshot(db_path, task_id, snapshot_id)
}

/// Get a single task by id from DB.
#[allow(dead_code)]
pub fn get_task_by_id(db_path: &Path, task_id: &str) -> Result<Option<TaskRecordPayload>, String> {
    crate::task_repository::get_task_by_id(db_path, task_id)
}

/// List all tasks from DB.
pub fn list_tasks(db_path: &Path) -> Result<Vec<TaskRecordPayload>, String> {
    crate::task_repository::list_tasks(db_path)
}

/// Get current task state from DB.
pub fn get_task_state(db_path: &Path, task_id: &str) -> Result<Option<String>, String> {
    crate::task_repository::get_task_state(db_path, task_id)
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
        let id = create_task(&db_path, "Test Task", "", "cursor", "{}", None)
            .expect("create_task");
        let tasks = list_tasks(&db_path).expect("list_tasks");
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].id, id);
        assert_eq!(tasks[0].engine_id, "cursor");
    }

    #[test]
    fn test_task_update_runtime_binding_persists() {
        let (_dir, db_path) = temp_db_path();
        let id = create_task(&db_path, "Task", "", "cursor", "{}", None).expect("create_task");
        update_task_engine(&db_path, &id, "claude", Some("haiku")).expect("update_task_engine");
        let tasks = list_tasks(&db_path).expect("list_tasks");
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].engine_id, "claude");
        assert_eq!(tasks[0].profile_id.as_deref(), Some("haiku"));
    }

    #[test]
    fn test_task_list_returns_engine_id() {
        let (_dir, db_path) = temp_db_path();
        create_task(&db_path, "A", "", "engine_x", "{}", None).expect("create");
        create_task(&db_path, "B", "", "engine_y", "{}", None).expect("create");
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
        crate::task_repository::ensure_tables(&conn).unwrap();
        drop(conn);
        let err = update_task_engine(&db_path, "nonexistent", "cursor", None).unwrap_err();
        assert!(err.contains("task not found"));
    }

    #[test]
    fn test_task_create_persists_profile_id() {
        let (_dir, db_path) = temp_db_path();
        let _id = create_task(&db_path, "Task", "", "cursor", "{}", Some("default"))
            .expect("create_task");
        let tasks = list_tasks(&db_path).expect("list_tasks");
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].profile_id.as_deref(), Some("default"));
    }

    #[test]
    fn test_task_switch_engine_request_deserializes() {
        let json = r#"{"taskId":"t1","engineId":"claude","sessionId":"sess-1"}"#;
        let req: TaskSwitchRuntimeBindingRequest = serde_json::from_str(json).expect("deserialize");
        assert_eq!(req.task_id, "t1");
        assert_eq!(req.engine_id, "claude");
        assert_eq!(req.session_id.as_deref(), Some("sess-1"));

        let json_no_session = r#"{"taskId":"t2","engineId":"cursor"}"#;
        let req2: TaskSwitchRuntimeBindingRequest = serde_json::from_str(json_no_session).expect("deserialize");
        assert_eq!(req2.task_id, "t2");
        assert_eq!(req2.engine_id, "cursor");
        assert!(req2.session_id.is_none());
    }
}
