use super::MaestroCore;
use super::error;
use std::sync::Arc;
use tauri::AppHandle;
use tauri::ipc::Channel;
use crate::core::events::{EventStream, StringStream};
use crate::workflow::types::{ChatApiRequest, ChatExecuteCliRequest, StepRunRequest, WorkflowRunRequest};
use crate::workflow::chat::{chat_execute_api_core, chat_execute_cli_core};
use crate::workflow::run::{workflow_run_core, workflow_run_step_core};

impl MaestroCore {
    /// Workflow run - creates Execution at start, persists at end.
    /// When task_id exists and app is provided, ensures execution binding before run.
    pub async fn workflow_run(
        &self,
        app: Option<AppHandle>,
        emitter: Arc<dyn EventStream>,
        request: WorkflowRunRequest,
    ) -> Result<crate::workflow::types::WorkflowRunResult, String> {
        workflow_run_core(
            app,
            emitter,
            request,
            &self.config.get(),
            &self.pty_state,
        )
        .await
    }

    /// Workflow run single step. StepRunRequest has no task_id; binding not required.
    pub async fn workflow_run_step(
        &self,
        _app: Option<AppHandle>,
        emitter: Arc<dyn EventStream>,
        request: StepRunRequest,
    ) -> Result<crate::workflow::types::StepRunResult, String> {
        workflow_run_step_core(
            emitter,
            request,
            &self.config.get(),
            &self.pty_state,
        )
        .await
    }

    /// Chat execute via API - creates Execution, registers with headless, spawns
    pub async fn chat_execute_api(
        &self,
        app: Option<AppHandle>,
        request: ChatApiRequest,
        on_data: Arc<dyn StringStream>,
    ) -> Result<crate::workflow::types::ChatExecuteApiResult, error::CoreError> {
        chat_execute_api_core(app, request, self.config.get(), &self.headless_state, on_data).await
    }

    /// Chat execute via CLI - creates Execution, registers with headless, spawns
    pub async fn chat_execute_cli(
        &self,
        app: Option<AppHandle>,
        request: ChatExecuteCliRequest,
        on_data: Arc<dyn StringStream>,
    ) -> Result<crate::workflow::types::ChatExecuteCliResult, error::CoreError> {
        chat_execute_cli_core(app, request, self.config.get(), &self.headless_state, on_data).await
    }

    /// Use-Case: Chat spawn - creates a raw pseudo-terminal session for CLI chat
    pub fn chat_spawn(
        &self,
        app: Option<AppHandle>,
        request: crate::workflow::types::ChatSpawnRequest,
        on_data: Channel<String>,
    ) -> Result<crate::workflow::types::ChatSessionMeta, error::CoreError> {
        crate::workflow::chat::chat_spawn_core(app.as_ref(), request, &self.config.get(), &self.pty_state, on_data)
    }

    /// Use-Case: Save last conversation state
    pub async fn chat_save_last_conversation(
        &self,
        app: AppHandle,
        payload: serde_json::Value,
    ) -> Result<(), error::CoreError> {
        crate::workflow::chat::chat_save_last_conversation_core(app, payload).await
    }

    /// Use-Case: Load last conversation state
    pub async fn chat_load_last_conversation(
        &self,
        app: AppHandle,
    ) -> Result<Option<serde_json::Value>, error::CoreError> {
        crate::workflow::chat::chat_load_last_conversation_core(app).await
    }
}
