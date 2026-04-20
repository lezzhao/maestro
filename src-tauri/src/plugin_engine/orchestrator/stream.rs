use crate::agent_state::{AppEventHandle, AgentStateUpdate};
use crate::tools::ToolCall;
use crate::core::events::StringStream;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StreamMode {
    Content,
    Reasoning,
}

pub struct ToolInterceptStream {
    pub event_handle: Arc<dyn AppEventHandle>,
    pub task_id: Option<String>,
    pub message_id: Mutex<Option<String>>,
    pub inner: Arc<dyn StringStream>,
    pub current_tool_calls: Mutex<Vec<ToolCall>>,
    pub accumulated_text: Mutex<String>,
    pub reasoning_text: Mutex<String>,
    pub cumulative_cost: Arc<Mutex<f64>>,
    pub model: String,
    pub sensitive_strings: Vec<String>,
    pub state_token: Option<String>,
    
    // State machine fields
    mode: Mutex<StreamMode>,
    buffer: Mutex<String>, // Partial tag buffer
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
            cumulative_cost,
            model,
            sensitive_strings,
            state_token,
            mode: Mutex::new(StreamMode::Content),
            buffer: Mutex::new(String::new()),
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
        self.accumulated_text.lock().unwrap().clone()
    }

    pub fn get_reasoning(&self) -> Option<String> {
        let res = self.reasoning_text.lock().unwrap().clone();
        if res.is_empty() { None } else { Some(res) }
    }

    fn handle_control_message(&self, data: &str) -> bool {
        if !data.starts_with('\u{0}') {
            return false;
        }

        if let Some(json) = data.strip_prefix("\u{0}TOOL_CALL:") {
            self.parse_tool_call(json);
        } else if let Some(json) = data.strip_prefix("\u{0}TOKEN_USAGE:") {
            self.parse_token_usage(json);
        }
        true
    }

    fn parse_tool_call(&self, json: &str) {
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
    }

    fn parse_token_usage(&self, json: &str) {
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

    fn emit_reasoning(&self, content: &str) {
        let mut text = self.reasoning_text.lock().unwrap();
        text.push_str(content);
        if let (Some(tid), Some(mid)) = (&self.task_id, &*self.message_id.lock().unwrap()) {
            self.event_handle.emit_state_update_with_token(
                AgentStateUpdate::Reasoning {
                    task_id: tid.clone(),
                    message_id: mid.clone(),
                    content: text.clone(),
                },
                self.state_token.clone(),
            );
        }
    }

    fn emit_content(&self, content: &str) -> Result<(), String> {
        self.accumulated_text.lock().unwrap().push_str(content);
        self.inner.send_string(content.to_string())
    }
}

impl StringStream for ToolInterceptStream {
    fn send_string(&self, data: String) -> Result<(), String> {
        let data = crate::redact::redact_sensitive(&data, Some(&self.sensitive_strings));
        if data.is_empty() || self.handle_control_message(&data) {
            return Ok(());
        }

        let mut buffer = self.buffer.lock().unwrap();
        buffer.push_str(&data);

        let start_tag = "<think>";
        let end_tag = "</think>";

        loop {
            let mut mode = self.mode.lock().unwrap();
            match *mode {
                StreamMode::Content => {
                    if let Some(pos) = buffer.find(start_tag) {
                        let before = buffer[..pos].to_string();
                        if !before.is_empty() { self.emit_content(&before)?; }
                        *mode = StreamMode::Reasoning;
                        *buffer = buffer[pos + start_tag.len()..].to_string();
                    } else {
                        // Check for partial tag start
                        let max_match = (1..start_tag.len())
                            .filter(|&i| buffer.ends_with(&start_tag[..i]))
                            .max()
                            .unwrap_or(0);
                        
                        let safe_to_send = buffer[..buffer.len() - max_match].to_string();
                        if !safe_to_send.is_empty() { self.emit_content(&safe_to_send)?; }
                        *buffer = buffer[buffer.len() - max_match..].to_string();
                        break;
                    }
                }
                StreamMode::Reasoning => {
                    if let Some(pos) = buffer.find(end_tag) {
                        let before = buffer[..pos].to_string();
                        if !before.is_empty() { self.emit_reasoning(&before); }
                        *mode = StreamMode::Content;
                        *buffer = buffer[pos + end_tag.len()..].to_string();
                    } else {
                        // Check for partial tag end
                        let max_match = (1..end_tag.len())
                            .filter(|&i| buffer.ends_with(&end_tag[..i]))
                            .max()
                            .unwrap_or(0);

                        let safe_to_send = buffer[..buffer.len() - max_match].to_string();
                        if !safe_to_send.is_empty() { self.emit_reasoning(&safe_to_send); }
                        *buffer = buffer[buffer.len() - max_match..].to_string();
                        break;
                    }
                }
            }
        }
        Ok(())
    }
}
