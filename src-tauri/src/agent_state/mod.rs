pub mod emitter;
pub mod payloads;
pub mod registry;

pub use emitter::*;
pub use payloads::*;

use serde::{Deserialize, Serialize};

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
        binding: crate::task::state::TaskRuntimeBinding,
    },
    TaskRuntimeContextResolved {
        task_id: String,
        context: crate::task::runtime::ResolvedRuntimeContext,
    },
    ExecutionStarted {
        task_id: String,
        run_id: String,
        cycle_id: String,
        mode: String,
    },
    TaskSuspended {
        task_id: String,
        run_id: String,
        reason: String,
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
        workspace: crate::infra::workspace_commands::Workspace,
    },
    WorkspaceUpdated {
        workspace: crate::infra::workspace_commands::Workspace,
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
    PendingQuestion {
        task_id: String,
        request_id: String,
        question_text: String,
        options: Vec<String>,
        allow_custom: bool,
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
    PerformanceMetrics {
        metrics: AgentPerformance,
    },
}

// --- Helper Constructors ---

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

pub fn build_choice_meta(payload: &ChoicePayload) -> serde_json::Value {
    serde_json::json!({ "choice": payload })
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
