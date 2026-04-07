use crate::agent_state::{AppEventHandle, AgentStateUpdate};
use crate::tools::ToolCall;
use crate::core::events::StringStream;
use std::sync::{Arc, Mutex};

pub struct ToolInterceptStream {
    pub event_handle: Arc<dyn AppEventHandle>,
    pub task_id: Option<String>,
    pub message_id: Mutex<Option<String>>,
    pub inner: Arc<dyn StringStream>,
    pub current_tool_calls: Mutex<Vec<ToolCall>>,
    pub accumulated_text: Mutex<String>,
    pub reasoning_text: Mutex<String>,
    pub is_reasoning: Mutex<bool>,
    pub cumulative_cost: Arc<Mutex<f64>>,
    pub model: String,
    pub sensitive_strings: Vec<String>,
    pub state_token: Option<String>,
}

impl ToolInterceptStream {
    pub fn new(
        event_handle: Arc<dyn AppEventHandle>, 
        task_id: Option<String>, 
        inner: Arc<dyn StringStream>,
        cumulative_cost: Arc<Mutex<f64>>,
        model: String,
        sensitive_strings: Vec<String>,
        state_token: Option<String>,
    ) -> Self {
        Self {
            event_handle,
            task_id,
            message_id: Mutex::new(None),
            inner,
            current_tool_calls: Mutex::new(Vec::new()),
            accumulated_text: Mutex::new(String::new()),
            reasoning_text: Mutex::new(String::new()),
            is_reasoning: Mutex::new(false),
            cumulative_cost,
            model,
            sensitive_strings,
            state_token,
        }
    }

    pub fn set_message_id(&self, id: String) {
        *self.message_id.lock().unwrap() = Some(id);
    }

    pub fn take_tool_calls(&self) -> Vec<ToolCall> {
        let mut calls = self.current_tool_calls.lock().unwrap();
        std::mem::take(&mut *calls)
    }

    pub fn take_accumulated_text(&self) -> String {
        let buf = self.accumulated_text.lock().unwrap();
        buf.clone()
    }
}

impl StringStream for ToolInterceptStream {
    fn send_string(&self, data: String) -> Result<(), String> {
        // Apply Redaction
        let data = crate::redact::redact_sensitive(&data, Some(&self.sensitive_strings));

        if data.contains("<think>") {
            *self.is_reasoning.lock().unwrap() = true;
            return Ok(());
        }
        if data.contains("</think>") {
            *self.is_reasoning.lock().unwrap() = false;
            return Ok(());
        }

        if *self.is_reasoning.lock().unwrap() {
            let mut reasoning = self.reasoning_text.lock().unwrap();
            reasoning.push_str(&data);
            if let (Some(tid), Some(mid)) = (&self.task_id, &*self.message_id.lock().unwrap()) {
                self.event_handle.emit_state_update_with_token(
                    AgentStateUpdate::Reasoning {
                        task_id: tid.clone(),
                        message_id: mid.clone(),
                        content: reasoning.clone(),
                    },
                    self.state_token.clone(),
                );
            }
            return Ok(());
        }
        
        // Skip control tags in accumulated text
        if !data.starts_with("<think>\n") && !data.starts_with("\n</think>\n") {
             self.accumulated_text.lock().unwrap().push_str(&data);
        }

        if data.starts_with('\u{0}') {
            if let Some(json) = data.strip_prefix("\u{0}TOOL_CALL:") {
                // ... Tool Call logic remains same as it processes the JSON ...
                if let Ok(tc) = serde_json::from_str::<ToolCall>(json) {
                    let mut calls = self.current_tool_calls.lock().unwrap();
                    if let Some(existing) = calls.iter_mut().find(|e| e.id == tc.id && !tc.id.is_empty()) {
                        existing.arguments.push_str(&tc.arguments);
                    } else if !tc.id.is_empty() {
                        calls.push(tc);
                    } else if let Some(last) = calls.last_mut() {
                        last.arguments.push_str(&tc.arguments);
                    }
                }
            } else if let Some(json) = data.strip_prefix("\u{0}TOKEN_USAGE:") {
                if let Ok(u) = serde_json::from_str::<crate::api_provider::sse::Usage>(json) {
                     let pricing = crate::plugin_engine::orchestrator::cost::get_pricing(&self.model);
                     let cost = crate::plugin_engine::orchestrator::cost::calculate_cost(u.prompt_tokens, u.completion_tokens, &pricing);
                     *self.cumulative_cost.lock().unwrap() += cost;

                     if let (Some(tid), Some(mid)) = (&self.task_id, &*self.message_id.lock().unwrap()) {
                        self.event_handle.emit_state_update_with_token(
                            AgentStateUpdate::MessageTokenUsage {
                                task_id: tid.clone(),
                                message_id: mid.clone(),
                                input_tokens: u.prompt_tokens,
                                output_tokens: u.completion_tokens,
                                total_tokens: u.total_tokens,
                            },
                            self.state_token.clone(),
                        );
                    }
                }
            }
            return Ok(());
        }
        
        self.inner.send_string(data)
    }
}
