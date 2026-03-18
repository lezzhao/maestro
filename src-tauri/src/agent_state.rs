//! Agent state persistence and event emission for "Logic to Rust" architecture.
//! Emits `agent://state-update` events so the frontend can stay in sync with backend state.
//!
//! Event hierarchy: Runtime uses only projection events.
//! - TaskRuntimeBindingChanged: TaskRuntimeContextResolved are the runtime main events.
//! - Do not add field-level engine/profile patch events (e.g. task_engine_changed).
//!
//! Frontend consumption priority: resolved context > binding > other. Runtime display
//! should prefer authoritative resolved context from backend, not self-assemble from binding.

use crate::workspace_commands::Workspace;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

pub const AGENT_STATE_UPDATE_EVENT: &str = "agent://state-update";

/// Payload for agent state update events. Frontend subscribes and updates chatStore/appStore.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentStateUpdate {
    RunCreated {
        task_id: String,
        run: TaskRunPayload,
    },
    RunFinished {
        task_id: String,
        run_id: String,
        status: String,
        error: Option<String>,
    },
    MessagesUpdated {
        task_id: String,
        messages: Vec<PersistedMessagePayload>,
    },
    TaskCreated {
        task: TaskRecordPayload,
    },
    TaskStateChanged {
        task_id: String,
        from_state: String,
        to_state: String,
    },
    TaskDeleted { task_id: String },
    TaskRuntimeBindingChanged {
        task_id: String,
        binding: crate::task_state::TaskRuntimeBinding,
    },
    TaskRuntimeContextResolved {
        task_id: String,
        context: crate::task_runtime::ResolvedRuntimeContext,
    },
    ExecutionStarted {
        task_id: String,
        run_id: String,
        mode: String,
    },
    ExecutionCancelled {
        task_id: String,
        run_id: String,
    },
    ExecutionOutputChunk {
        task_id: String,
        run_id: String,
        chunk: String,
    },
    WorkspaceCreated {
        workspace: Workspace,
    },
    WorkspaceUpdated {
        workspace: Workspace,
    },
    WorkspaceDeleted {
        workspace_id: String,
    },
    EnginePreflightComplete {
        engine_id: String,
        result: crate::engine::EnginePreflightResult,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskRecordPayload {
    pub id: String,
    pub title: String,
    pub description: String,
    pub engine_id: String,
    pub current_state: String,
    pub workspace_boundary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_snapshot_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub settings: Option<String>,
    /// Unix timestamp in milliseconds.
    pub created_at: i64,
    /// Unix timestamp in milliseconds.
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskRunPayload {
    pub id: String,
    pub task_id: String,
    pub engine_id: String,
    pub mode: String,
    pub status: String,
    pub created_at: i64,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistedMessagePayload {
    pub id: String,
    pub role: String,
    pub content: String,
}

/// Emit agent state update to frontend. No-op if app is None (e.g. daemon mode).
pub fn emit_state_update(app: Option<&AppHandle>, payload: AgentStateUpdate) {
    if let Some(handle) = app {
        let value = serde_json::to_value(&payload).unwrap_or_default();
        let _ = handle.emit(AGENT_STATE_UPDATE_EVENT, value);
    }
}

/// Build TaskRunPayload from Execution for run_created event.
pub fn task_run_from_execution(
    id: &str,
    task_id: &str,
    engine_id: &str,
    mode: &str,
    created_at: i64,
) -> TaskRunPayload {
    TaskRunPayload {
        id: id.to_string(),
        task_id: task_id.to_string(),
        engine_id: engine_id.to_string(),
        mode: mode.to_string(),
        status: "running".to_string(),
        created_at,
        started_at: created_at,
        ended_at: None,
        error: None,
    }
}

/// Build run_finished payload.
pub fn run_finished_payload(
    task_id: &str,
    run_id: &str,
    status: &str,
    error: Option<String>,
) -> AgentStateUpdate {
    AgentStateUpdate::RunFinished {
        task_id: task_id.to_string(),
        run_id: run_id.to_string(),
        status: status.to_string(),
        error,
    }
}
