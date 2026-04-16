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
        let start = std::time::Instant::now();
        let _permit = self.run_queue.acquire().await.map_err(|e| error::CoreError::SystemError {
            message: format!("Queue acquisition failed: {}", e),
        })?;
        
        let result = workflow_run_core(event_handle.clone(), emitter, request.clone(), &self.config.get(), &self.pty_state).await;
        
        if let Ok(ref res) = result {
            let duration_ms = start.elapsed().as_millis() as u64;
            let input_tokens = res.step_results.iter().map(|s| s.token_estimate.approx_input_tokens as u64).sum::<u64>();
            let output_tokens = res.step_results.iter().map(|s| s.token_estimate.approx_output_tokens as u64).sum::<u64>();
            let total_tokens = input_tokens + output_tokens;

            event_handle.emit_performance_metrics(crate::agent_state::AgentPerformance {
                task_id: request.task_id.clone().unwrap_or_default(),
                run_id: res.archive_path.clone(),
                duration_ms,
                input_tokens,
                output_tokens,
                total_tokens,
                cost_usd: 0.0,
            });
        }
        result
    }

    /// Workflow run single step. StepRunRequest has no task_id; binding not required.
    pub async fn workflow_run_step(
        &self,
        event_handle: Arc<dyn AppEventHandle>,
        emitter: Arc<dyn EventStream>,
        request: StepRunRequest,
    ) -> Result<crate::workflow::types::StepRunResult, error::CoreError> {
        let start = std::time::Instant::now();
        let _permit = self.run_queue.acquire().await.map_err(|e| error::CoreError::SystemError {
            message: format!("Queue acquisition failed: {}", e),
        })?;
        
        let result = workflow_run_step_core(event_handle.clone(), emitter, request.clone(), &self.config.get(), &self.pty_state).await;
        
        if let Ok(ref res) = result {
            let duration_ms = start.elapsed().as_millis() as u64;
            event_handle.emit_performance_metrics(crate::agent_state::AgentPerformance {
                task_id: "step".to_string(),
                run_id: request.workflow_name.clone(),
                duration_ms,
                input_tokens: res.token_estimate.approx_input_tokens as u64,
                output_tokens: res.token_estimate.approx_output_tokens as u64,
                total_tokens: (res.token_estimate.approx_input_tokens + res.token_estimate.approx_output_tokens) as u64,
                cost_usd: 0.0,
            });
        }
        result
    }

    /// Chat execute via API - creates Execution, registers with headless, spawns
    pub async fn chat_execute_api(
        self: Arc<Self>,
        event_handle: Arc<dyn AppEventHandle>,
        request: ChatApiRequest,
        on_data: Arc<dyn StringStream>,
    ) -> Result<crate::workflow::types::ChatExecuteApiResult, error::CoreError> {
        let start = std::time::Instant::now();
        let permit = self.run_queue.acquire().await.map_err(|e| error::CoreError::SystemError {
            message: format!("Queue acquisition failed: {}", e),
        })?;
        
        let result = chat_execute_api_core(
            event_handle.clone(),
            self.clone(),
            request.clone(),
            (*self.config.get()).clone(),
            &self.headless_state,
            on_data,
            Some(permit),
        )
        .await;

        if let Ok(ref res) = result {
            let duration_ms = start.elapsed().as_millis() as u64;
            event_handle.emit_performance_metrics(crate::agent_state::AgentPerformance {
                task_id: request.task_id.clone().unwrap_or_default(),
                run_id: res.run_id.clone(),
                duration_ms,
                input_tokens: 0,
                output_tokens: 0,
                total_tokens: 0,
                cost_usd: 0.0,
            });
        }
        result
    }

    /// Chat execute via CLI - creates Execution, registers with headless, spawns
    pub async fn chat_execute_cli(
        self: Arc<Self>,
        event_handle: Arc<dyn AppEventHandle>,
        request: ChatExecuteCliRequest,
        on_data: Arc<dyn StringStream>,
    ) -> Result<crate::workflow::types::ChatExecuteCliResult, error::CoreError> {
        let start = std::time::Instant::now();
        let permit = self.run_queue.acquire().await.map_err(|e| error::CoreError::SystemError {
            message: format!("Queue acquisition failed: {}", e),
        })?;

        let result = chat_execute_cli_core(
            event_handle.clone(),
            self.clone(),
            request.clone(),
            (*self.config.get()).clone(),
            &self.headless_state,
            on_data,
            Some(permit),
        )
        .await;

        if let Ok(ref res) = result {
            let duration_ms = start.elapsed().as_millis() as u64;
            event_handle.emit_performance_metrics(crate::agent_state::AgentPerformance {
                task_id: request.task_id.clone().unwrap_or_default(),
                run_id: res.run_id.clone(),
                duration_ms,
                input_tokens: 0,
                output_tokens: 0,
                total_tokens: 0,
                cost_usd: 0.0,
            });
        }
        result
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
            Box::new(move |text| {
                let _ = on_data.send(text);
            }),
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
