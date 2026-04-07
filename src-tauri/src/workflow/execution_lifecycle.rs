use std::sync::Arc;
use crate::agent_state::AppEventHandle;
use crate::core::execution::{Execution, ExecutionMode};
use crate::headless::HeadlessProcessState;
use crate::core::events::StringStream;
use crate::storage::run_persistence::append_run_record;
use crate::infra::workspace_io::WorkspaceIo;
use crate::workflow::protocol::StreamFrame;
use crate::workflow::types::{VerificationSummary};
use tokio_util::sync::CancellationToken;

pub struct ExecutionLifecycle {
    pub event_handle: Arc<dyn AppEventHandle>,
    pub headless_state: HeadlessProcessState,
    pub task_id: String,
    pub run_id: String,
    pub exec_id: String,
    pub cycle_id: String,
    pub on_data: Arc<dyn StringStream>,
    pub io_opt: Option<WorkspaceIo>,
    pub api_key: Option<String>,
    pub state_token: Option<String>,
}

impl ExecutionLifecycle {
    pub fn new(
        event_handle: Arc<dyn AppEventHandle>,
        headless_state: &HeadlessProcessState,
        execution: Execution,
        cancel_token: CancellationToken,
        cycle_id: String,
        on_data: Arc<dyn StringStream>,
        io_opt: Option<WorkspaceIo>,
        api_key: Option<String>,
        state_token: Option<String>,
    ) -> Self {
        let task_id = execution.task_id.clone();
        let run_id = execution.id.clone();
        let mode = match execution.mode {
            ExecutionMode::Cli => "cli",
            _ => "api",
        };

        // Emit events for event-driven frontend sync
        event_handle.emit_state_update_with_token(
            crate::agent_state::AgentStateUpdate::ExecutionStarted {
                task_id: task_id.clone(),
                run_id: run_id.clone(),
                cycle_id: cycle_id.clone(),
                mode: mode.to_string(),
            },
            state_token.clone(),
        );

        let run_payload = crate::agent_state::task_run_from_execution(
            &run_id,
            &task_id,
            &execution.engine_id,
            mode,
            execution.created_at,
        );
        event_handle.emit_state_update_with_token(
            crate::agent_state::AgentStateUpdate::RunCreated {
                task_id: task_id.clone(),
                run: run_payload,
            },
            state_token.clone(),
        );

        let exec_id = headless_state.register(execution, cancel_token);
        
        // Send RUN_ID frame
        let _ = on_data.send_string(StreamFrame::RunId(run_id.clone()).to_frame_string());

        Self {
            event_handle,
            headless_state: headless_state.clone(),
            task_id,
            run_id,
            exec_id,
            cycle_id,
            on_data,
            io_opt,
            api_key,
            state_token,
        }
    }

    pub fn send_verification(&self, v: crate::workflow::types::VerificationSummary) {
        let _ = self.on_data.send_string(StreamFrame::Verification(v).to_frame_string());
    }

    pub fn send_exit(&self, code: i32) {
        let _ = self.on_data.send_string(StreamFrame::Exit(code).to_frame_string());
    }

    pub fn send_token_usage(&self, input: usize, output: usize) {
        let payload = crate::workflow::protocol::TokenUsagePayload {
            approx_input_tokens: input,
            approx_output_tokens: output,
        };
        let _ = self.on_data.send_string(StreamFrame::TokenUsage(payload).to_frame_string());
    }

    pub fn send_tool_approval_request(&self, request_id: String, tool_name: String, args: serde_json::Value) {
        let payload = crate::workflow::protocol::ToolApprovalPayload {
            request_id,
            tool_name,
            arguments: args,
        };
        let _ = self.on_data.send_string(StreamFrame::ToolApprovalRequest(payload).to_frame_string());
    }

    /// Complete the lifecycle by emitting results and persisting logs.
    pub fn finish<T, E: std::fmt::Display>(
        self,
        result: Result<T, E>,
        output_preview: String,
        verification: Option<VerificationSummary>,
    ) {
        // Send final frames to stream
        match &result {
            Ok(_) => {
                let _ = self.on_data.send_string(StreamFrame::Done.to_frame_string());
            }
            Err(err) => {
                let _ = self.on_data.send_string(StreamFrame::Error(err.to_string()).to_frame_string());
            }
        }

        // Persist to database state
        let execution_result = match &result {
            Ok(_) => self.headless_state.complete_and_extract(
                &self.exec_id,
                output_preview,
                verification,
            ),
            Err(err) => {
                let msg = err.to_string();
                self.headless_state.fail_and_extract(
                    &self.exec_id,
                    &msg,
                    msg.chars().take(300).collect::<String>(),
                )
            }
        };

        // Persist to disk
        if let (Some(io), Ok(exec)) = (self.io_opt.as_ref(), execution_result) {
            let extra_secrets = self.api_key.clone().map(|k| vec![k]);
            if let Err(e) = append_run_record(io, &exec, extra_secrets.as_deref()) {
                eprintln!("ExecutionLifecycle: append_run_record failed: {e}");
            }
        }

        // Emit final state update
        let (status, err_msg) = match &result {
            Ok(_) => ("done", None),
            Err(e) => ("error", Some(e.to_string())),
        };
        self.event_handle.emit_state_update_with_token(
            crate::agent_state::AgentStateUpdate::RunFinished {
                task_id: self.task_id.clone(),
                run_id: self.run_id.clone(),
                status: status.to_string(),
                error: err_msg,
                reconciliation: true,
            },
            self.state_token.clone(),
        );
    }
}
