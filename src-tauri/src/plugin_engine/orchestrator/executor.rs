use crate::agent_state::AppEventHandle;
use crate::tools::{ToolBox, ToolCall};
use crate::core::MaestroCore;
use tokio::sync::oneshot;
use std::sync::Arc;
use tokio_util::sync::CancellationToken;
use crate::plugin_engine::EngineError;

pub struct ToolExecutor {
    pub event_handle: Arc<dyn AppEventHandle>,
    pub core: Arc<MaestroCore>,
    pub toolbox: Arc<ToolBox>,
    pub cancel_token: CancellationToken,
    pub state_token: Option<String>,
}

impl ToolExecutor {
    pub fn new(event_handle: Arc<dyn AppEventHandle>, core: Arc<MaestroCore>, toolbox: Arc<ToolBox>, cancel_token: CancellationToken, state_token: Option<String>) -> Self {
        Self {
            event_handle,
            core,
            toolbox,
            cancel_token,
            state_token,
        }
    }

    pub async fn execute(&self, task_id: Option<String>, tc: &ToolCall) -> Result<String, EngineError> {
        let tool_name = tc.name.clone();
        let mut tool_input = tc.arguments.clone();

        // 1. Emit ToolStarted
        self.emit_tool_started(task_id.as_deref(), &tool_name, &tool_input);

        // 2. Safety Check (Human-in-the-loop)
        if let Some(def) = self.toolbox.get_tool_definition(&tc.name) {
            if def.requires_confirmation {
                let response = self.request_confirmation(task_id.as_deref(), tc).await?;
                if !response.approved {
                    self.emit_tool_finished(task_id.as_deref(), &tool_name, "Error: User rejected tool execution.", false, 0);
                    return Ok("Error: User rejected tool execution.".into());
                }
                if let Some(edited) = response.edited_arguments {
                    tool_input = edited;
                }
            }
        }

        // 3. Execution
        let start_time = std::time::Instant::now();
        let result = self.toolbox.execute(&tc.name, &tool_input, self.cancel_token.clone()).await;
        let duration_ms = start_time.elapsed().as_millis() as u64;

        let (success, tool_output) = match result {
            Ok(out) => (true, out),
            Err(e) => (false, format!("Error: {e}")),
        };

        // 4. Emit ToolFinished
        self.emit_tool_finished(task_id.as_deref(), &tool_name, &tool_output, success, duration_ms);

        Ok(tool_output)
    }

    fn emit_tool_started(&self, task_id: Option<&str>, tool_name: &str, tool_input: &str) {
        if let (Some(tid), Some(mid)) = (task_id, &self.core.get_active_assistant_msg_id(task_id)) {
            self.event_handle.emit_state_update_with_token(
                crate::agent_state::AgentStateUpdate::ToolStarted {
                    task_id: tid.to_string(),
                    message_id: mid.clone(),
                    tool_name: tool_name.to_string(),
                    tool_input: tool_input.to_string(),
                },
                self.state_token.clone(),
            );
        }
    }

    fn emit_tool_finished(&self, task_id: Option<&str>, tool_name: &str, tool_output: &str, success: bool, duration_ms: u64) {
        if let (Some(tid), Some(mid)) = (task_id, &self.core.get_active_assistant_msg_id(task_id)) {
            self.event_handle.emit_state_update_with_token(
                crate::agent_state::AgentStateUpdate::ToolFinished {
                    task_id: tid.to_string(),
                    message_id: mid.clone(),
                    tool_name: tool_name.to_string(),
                    tool_output: tool_output.to_string(),
                    success,
                    duration_ms,
                    stdout: None,
                    stderr: None,
                },
                self.state_token.clone(),
            );
        }
    }

    async fn request_confirmation(&self, task_id: Option<&str>, tc: &ToolCall) -> Result<crate::safety::ApprovalResponse, EngineError> {
        let request_id = uuid::Uuid::new_v4().to_string();
        let (tx, rx) = oneshot::channel();
        self.core.safety_manager.register_approval(request_id.clone(), tx).await
            .map_err(|e| EngineError::Execution(e))?;

        let warning = self.derive_safety_warning(tc);
        let base_message = format!("Agent requests permission to execute tool: {}", tc.name);
        let final_message = if let Some(w) = warning {
            format!("⚠️ [SECURITY WARNING]: {}\n\n{}", w, base_message)
        } else {
            base_message
        };

        if let Some(tid) = task_id {
            self.event_handle.emit_state_update_with_token(
                crate::agent_state::AgentStateUpdate::PendingApproval {
                    task_id: tid.to_string(),
                    request_id: request_id.clone(),
                    tool_name: tc.name.clone(),
                    tool_input: tc.arguments.clone(),
                    message: final_message,
                },
                self.state_token.clone(),
            );
        }

        tokio::select! {
            _ = self.cancel_token.cancelled() => {
                self.core.safety_manager.remove_approval(&request_id).await;
                Err(EngineError::Execution("Cancelled".into()))
            }
            _ = tokio::time::sleep(std::time::Duration::from_secs(300)) => {
                self.core.safety_manager.remove_approval(&request_id).await;
                Err(EngineError::Execution("Approval request timed out".into()))
            }
            res = rx => Ok(res.unwrap_or(crate::safety::ApprovalResponse { approved: false, edited_arguments: None }))
        }
    }

    fn derive_safety_warning(&self, tc: &ToolCall) -> Option<String> {
        let name = tc.name.as_str();
        let input = tc.arguments.to_lowercase();

        match name {
            "run_command" => {
                if input.contains("rm -rf") && (input.contains("/") || input.contains("~") || input.contains("$home")) {
                    return Some("This command appears to perform a recursive deletion on a highly sensitive path. This could result in permanent data loss.".into());
                }
                if input.contains("sudo") {
                    return Some("This command requests root (administrator) privileges. Never run as sudo unless you are absolutely sure of what it does.".into());
                }
                if input.contains("chmod") || input.contains("chown") {
                    return Some("This command modifies file permissions or ownership, which could affect system stability or security.".into());
                }
                if input.contains("curl") || input.contains("wget") {
                    if input.contains("| sh") || input.contains("| bash") {
                        return Some("This command downloads and immediately executes a remote script. This is extremely dangerous.".into());
                    }
                }
            },
            "write_file" => {
                if input.contains(".ssh/") || input.contains(".bashrc") || input.contains(".zshrc") {
                     return Some("The agent is attempting to modify shell configuration or SSH keys. This could be used for persistence or lateral movement.".into());
                }
            },
            _ => {}
        }
        None
    }
}
