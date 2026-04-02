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
use std::sync::Arc;
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
        reconciliation: bool,
    },
    MessagesUpdated {
        task_id: String,
        messages: Vec<PersistedMessagePayload>,
    },
    MessageAppended {
        task_id: String,
        message: PersistedMessagePayload,
    },
    ChoiceResolved {
        task_id: String,
        message_id: String,
        option_id: String,
    },
    TaskCreated {
        task: TaskRecordPayload,
    },
    TaskUpdated {
        task: TaskRecordPayload,
    },
    TaskStateChanged {
        task_id: String,
        from_state: String,
        to_state: String,
    },
    TaskDeleted {
        task_id: String,
    },
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
    ExecutionTokenUsage {
        task_id: String,
        run_id: String,
        input_tokens: u64,
        output_tokens: u64,
    },
    PendingApproval {
        task_id: String,
        request_id: String,
        tool_name: String,
        tool_input: String,
        message: String,
    },
    Reasoning {
        task_id: String,
        message_id: String,
        content: String,
    },
    ToolStarted {
        task_id: String,
        message_id: String,
        tool_name: String,
        tool_input: String,
    },
    ToolFinished {
        task_id: String,
        message_id: String,
        tool_name: String,
        tool_output: String,
        success: bool,
        duration_ms: u64,
        #[serde(skip_serializing_if = "Option::is_none")]
        stdout: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        stderr: Option<String>,
    },
    MessageTokenUsage {
        task_id: String,
        message_id: String,
        input_tokens: u64,
        output_tokens: u64,
        total_tokens: u64,
    },
    Trace {
        task_id: String,
        content: String,
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

/// Choice 交互的 action 类型（前端根据 kind 分发执行）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChoiceAction {
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

/// Choice 交互的单个选项
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChoiceOption {
    pub id: String,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub action: ChoiceAction,
}

/// 结构化选择消息的 payload
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChoicePayload {
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub status: String,
    pub options: Vec<ChoiceOption>,
}

impl ChoiceAction {
    pub fn open_settings() -> Self {
        Self {
            kind: "open_settings".into(),
            mode: None,
            url: None,
        }
    }

    pub fn switch_execution_mode(mode: &str) -> Self {
        Self {
            kind: "switch_execution_mode".into(),
            mode: Some(mode.into()),
            url: None,
        }
    }
}

/// 从 ChoicePayload 构建嵌入 message.meta 的 JSON 对象
pub fn build_choice_meta(payload: &ChoicePayload) -> serde_json::Value {
    serde_json::json!({ "choice": payload })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistedAttachmentPayload {
    pub name: String,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snippet: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistedMessagePayload {
    pub id: String,
    pub role: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attachments: Option<Vec<PersistedAttachmentPayload>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meta: Option<serde_json::Value>,
}

pub fn append_system_message_payload(
    task_id: impl Into<String>,
    content: impl Into<String>,
    meta: Option<serde_json::Value>,
) -> AgentStateUpdate {
    AgentStateUpdate::MessageAppended {
        task_id: task_id.into(),
        message: PersistedMessagePayload {
            id: uuid::Uuid::new_v4().to_string(),
            role: "system".to_string(),
            content: content.into(),
            timestamp: None,
            status: None,
            attachments: None,
            meta,
        },
    }
}

pub fn resolve_choice_payload(
    task_id: impl Into<String>,
    message_id: impl Into<String>,
    option_id: impl Into<String>,
) -> AgentStateUpdate {
    AgentStateUpdate::ChoiceResolved {
        task_id: task_id.into(),
        message_id: message_id.into(),
        option_id: option_id.into(),
    }
}

/// Trait for emitting application events, decoupling business logic from Tauri.
pub trait AppEventHandle: Send + Sync {
    fn emit_state_update(&self, payload: AgentStateUpdate);
}

/// Default implementation for Tauri applications.
pub struct TauriEventHandle {
    pub handle: AppHandle,
}

impl TauriEventHandle {
    pub fn new(handle: AppHandle) -> Self {
        Self { handle }
    }

    pub fn arc(handle: AppHandle) -> Arc<dyn AppEventHandle> {
        Arc::new(Self::new(handle))
    }

    pub fn noop() -> Arc<dyn AppEventHandle> {
        Arc::new(NoopEventHandle)
    }
}

impl AppEventHandle for TauriEventHandle {
    fn emit_state_update(&self, payload: AgentStateUpdate) {
        emit_state_update(Some(&self.handle), payload);
    }
}

/// No-op implementation for testing and headless/daemon modes.
pub struct NoopEventHandle;

impl AppEventHandle for NoopEventHandle {
    fn emit_state_update(&self, _payload: AgentStateUpdate) {}
}

/// Emit agent state update to frontend via AppHandle.
pub fn emit_state_update(app: Option<&AppHandle>, payload: AgentStateUpdate) {
    if let Some(handle) = app {
        match serde_json::to_value(&payload) {
            Ok(value) => {
                if let Err(e) = handle.emit(AGENT_STATE_UPDATE_EVENT, value) {
                    tracing::error!("agent state event emit failed: {e}");
                }
            }
            Err(e) => {
                tracing::error!("agent state event serialize failed, skipping emit: {e}");
            }
        }
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
        reconciliation: true,
    }
}
