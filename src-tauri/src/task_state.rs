//! Task state facade: DB access, path resolution, re-exports.
//! Commands live in task_commands; lifecycle in task_lifecycle.

use crate::agent_state::TaskRecordPayload;
use std::path::Path;
use tauri::Manager;

pub use crate::task_lifecycle::{TaskEvent, TaskState, transition};
pub use crate::task_repository::TaskRuntimeBinding;

// Request/result types for core and task_commands
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

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskTransitionRequest {
    pub task_id: String,
    pub from_state: String,
    pub event_type: String,
    pub event_reason: Option<String>,
    #[serde(default = "default_true")]
    pub take_snapshot: bool,
}

fn default_true() -> bool {
    true
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskGetStateRequest {
    pub task_id: String,
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

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskUpdateRuntimeBindingRequest {
    pub task_id: String,
    pub engine_id: String,
    #[serde(default)]
    pub profile_id: Option<String>,
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

/// Resolve bmad_state.db path.
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
        let id = create_task(&db_path, "Test Task", "", "cursor", "{}", None).expect("create_task");
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
    fn test_update_task_engine_clears_runtime_snapshot_id() {
        let (_dir, db_path) = temp_db_path();
        let id = create_task(&db_path, "Task", "", "cursor", "{}", None).expect("create_task");
        update_task_runtime_snapshot(&db_path, &id, Some("snap-123")).expect("set snapshot");
        let binding = get_task_runtime_binding(&db_path, &id).expect("get binding");
        assert_eq!(binding.as_ref().and_then(|b| b.runtime_snapshot_id.as_deref()), Some("snap-123"));

        update_task_engine(&db_path, &id, "claude", Some("haiku")).expect("update_engine");
        let binding = get_task_runtime_binding(&db_path, &id).expect("get binding");
        assert!(binding.as_ref().and_then(|b| b.runtime_snapshot_id.as_ref()).is_none());
    }

    #[test]
    fn test_task_switch_engine_request_deserializes() {
        let json = r#"{"taskId":"t1","engineId":"claude","sessionId":"sess-1"}"#;
        let req: TaskSwitchRuntimeBindingRequest = serde_json::from_str(json).expect("deserialize");
        assert_eq!(req.task_id, "t1");
        assert_eq!(req.engine_id, "claude");
        assert_eq!(req.session_id.as_deref(), Some("sess-1"));

        let json_no_session = r#"{"taskId":"t2","engineId":"cursor"}"#;
        let req2: TaskSwitchRuntimeBindingRequest =
            serde_json::from_str(json_no_session).expect("deserialize");
        assert_eq!(req2.task_id, "t2");
        assert_eq!(req2.engine_id, "cursor");
        assert!(req2.session_id.is_none());
    }
}
