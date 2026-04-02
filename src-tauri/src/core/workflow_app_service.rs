use super::error;
use super::MaestroCore;
use crate::agent_state::AppEventHandle;
use crate::core::events::{EventStream, StringStream};
use crate::workflow::chat::{chat_execute_api_core, chat_execute_cli_core};
use crate::workflow::run::{workflow_run_core, workflow_run_step_core};
use crate::workflow::types::{
    ChatApiRequest, ChatExecuteCliRequest, StepRunRequest, WorkflowRunRequest,
};
use std::sync::Arc;
use tauri::ipc::Channel;

impl MaestroCore {
    /// Workflow run - creates Execution at start, persists at end.
    /// When task_id exists and app is provided, ensures execution binding before run.
    pub async fn workflow_run(
        &self,
        event_handle: Arc<dyn AppEventHandle>,
        emitter: Arc<dyn EventStream>,
        request: WorkflowRunRequest,
    ) -> Result<crate::workflow::types::WorkflowRunResult, error::CoreError> {
        workflow_run_core(event_handle, emitter, request, &self.config.get(), &self.pty_state).await
    }

    /// Workflow run single step. StepRunRequest has no task_id; binding not required.
    pub async fn workflow_run_step(
        &self,
        event_handle: Arc<dyn AppEventHandle>,
        emitter: Arc<dyn EventStream>,
        request: StepRunRequest,
    ) -> Result<crate::workflow::types::StepRunResult, error::CoreError> {
        workflow_run_step_core(event_handle, emitter, request, &self.config.get(), &self.pty_state).await
    }

    /// Chat execute via API - creates Execution, registers with headless, spawns
    pub async fn chat_execute_api(
        self: Arc<Self>,
        event_handle: Arc<dyn AppEventHandle>,
        request: ChatApiRequest,
        on_data: Arc<dyn StringStream>,
    ) -> Result<crate::workflow::types::ChatExecuteApiResult, error::CoreError> {
        chat_execute_api_core(
            event_handle,
            self.clone(),
            request,
            (*self.config.get()).clone(),
            &self.headless_state,
            on_data,
        )
        .await
    }

    /// Chat execute via CLI - creates Execution, registers with headless, spawns
    pub async fn chat_execute_cli(
        self: Arc<Self>,
        event_handle: Arc<dyn AppEventHandle>,
        request: ChatExecuteCliRequest,
        on_data: Arc<dyn StringStream>,
    ) -> Result<crate::workflow::types::ChatExecuteCliResult, error::CoreError> {
        chat_execute_cli_core(
            event_handle,
            self.clone(),
            request,
            (*self.config.get()).clone(),
            &self.headless_state,
            on_data,
        )
        .await
    }

    /// Use-Case: Chat spawn - creates a raw pseudo-terminal session for CLI chat
    pub fn chat_spawn(
        &self,
        event_handle: Arc<dyn AppEventHandle>,
        request: crate::workflow::types::ChatSpawnRequest,
        on_data: Channel<String>,
    ) -> Result<crate::workflow::types::ChatSessionMeta, error::CoreError> {
        crate::workflow::chat::chat_spawn_core(
            event_handle,
            request,
            &self.config.get(),
            &self.pty_state,
            on_data,
        )
    }

    /// Use-Case: Save last conversation state
    pub async fn chat_save_last_conversation(
        &self,
        event_handle: Arc<dyn AppEventHandle>,
        payload: serde_json::Value,
    ) -> Result<(), error::CoreError> {
        crate::workflow::chat::chat_save_last_conversation_core(event_handle, payload).await
    }

    /// Use-Case: Load last conversation state
    pub async fn chat_load_last_conversation(
        &self,
        event_handle: Arc<dyn AppEventHandle>,
    ) -> Result<Option<serde_json::Value>, error::CoreError> {
        crate::workflow::chat::chat_load_last_conversation_core(event_handle).await
    }
}
