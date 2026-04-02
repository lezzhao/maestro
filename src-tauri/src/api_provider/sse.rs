//! SSE (Server-Sent Events) parsing for streaming API responses.
//! Extracted from provider-specific logic for reuse and testability.

use super::ApiProviderError;
use serde_json::{json, Value};

use crate::tools::ToolCall;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Usage {
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub total_tokens: u64,
}

/// Parse OpenAI-compatible SSE format: `data: {...}` or `data: [DONE]`.
/// Returns (content_opt, reasoning_opt, tool_calls_opt, usage_opt, is_done).
/// Modifies buffer in place, consuming parsed lines.
pub fn parse_openai_line(
    buffer: &mut String,
) -> Option<(
    Option<String>,
    Option<String>,
    Option<Vec<ToolCall>>,
    Option<Usage>,
    bool,
)> {
    let pos = buffer.find('\n')?;
    let line = buffer[..pos].to_string();
    buffer.drain(..=pos);
    let trimmed = line.trim();
    if !trimmed.starts_with("data:") {
        return Some((None, None, None, None, false));
    }
    let payload = trimmed.trim_start_matches("data:").trim();
    if payload == "[DONE]" {
        return Some((None, None, None, None, true));
    }
    let value: Value = serde_json::from_str(payload).ok()?;
    let text = value
        .pointer("/choices/0/delta/content")
        .and_then(|v| v.as_str())
        .or_else(|| {
            value
                .pointer("/choices/0/delta/content/0/text")
                .and_then(|v| v.as_str())
        });
    let content = text.filter(|s| !s.is_empty()).map(|s| s.to_string());

    let reasoning_text = value
        .pointer("/choices/0/delta/reasoning_content")
        .and_then(|v| v.as_str());
    let reasoning = reasoning_text
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    let mut tool_calls = None;
    if let Some(tcs) = value.pointer("/choices/0/delta/tool_calls").and_then(|v| v.as_array()) {
        let mut list = Vec::new();
        for tc in tcs {
            let id = tc.pointer("/id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let name = tc.pointer("/function/name").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let args = tc.pointer("/function/arguments").and_then(|v| v.as_str()).unwrap_or("").to_string();
            if !id.is_empty() || !name.is_empty() || !args.is_empty() {
                list.push(ToolCall { id, name, arguments: args });
            }
        }
        if !list.is_empty() {
            tool_calls = Some(list);
        }
    }

    let mut usage = None;
    if let Some(u) = value.get("usage") {
        if let Ok(parsed_usage) = serde_json::from_value::<Usage>(u.clone()) {
            usage = Some(parsed_usage);
        }
    }

    Some((content, reasoning, tool_calls, usage, false))
}

/// Parsed Anthropic SSE event (event: + data: lines).
#[derive(Debug, Default)]
pub struct AnthropicEvent {
    pub event_type: String,
    pub data_lines: Vec<String>,
}

impl AnthropicEvent {
    pub fn is_complete(&self) -> bool {
        self.event_type == "message_stop"
    }

    /// Extract text content from content_block_delta event.
    pub fn extract_content(&self) -> Result<Option<String>, ApiProviderError> {
        if self.event_type == "message_stop" {
            return Ok(None);
        }
        if self.data_lines.is_empty() {
            return Ok(None);
        }
        let payload = self.data_lines.join("\n");
        let value: Value = serde_json::from_str(&payload)
            .map_err(|e| ApiProviderError::Execution(format!("解析响应失败: {e}")))?;
        
        let text = if self.event_type == "content_block_delta" {
            value.pointer("/delta/text").and_then(|v| v.as_str())
        } else if self.event_type == "message_start" {
             value.pointer("/message/content/0/text").and_then(|v| v.as_str())
        } else if self.event_type.is_empty() {
            let event_type = value.pointer("/type").and_then(|v| v.as_str());
            if event_type == Some("message_stop") {
                return Ok(None);
            }
            if event_type == Some("content_block_delta") {
                value.pointer("/delta/text").and_then(|v| v.as_str())
            } else {
                None
            }
        } else {
            None
        };
        Ok(text.filter(|s| !s.is_empty()).map(|s| s.to_string()))
    }

    /// Extract reasoning/thinking content from thinking block.
    pub fn extract_reasoning(&self) -> Result<Option<String>, ApiProviderError> {
        if self.event_type != "content_block_delta" {
            return Ok(None);
        }
        let payload = self.data_lines.join("\n");
        let value: Option<Value> = serde_json::from_str(&payload).ok();
        if let Some(v) = value {
            let text = v.pointer("/delta/thinking").and_then(|v| v.as_str());
            return Ok(text.filter(|s| !s.is_empty()).map(|s| s.to_string()));
        }
        Ok(None)
    }

    /// Extract tool calls from tool_use block.
    pub fn extract_tool_calls(&self) -> Result<Option<Vec<ToolCall>>, ApiProviderError> {
         if self.event_type != "content_block_start" && self.event_type != "content_block_delta" {
            return Ok(None);
        }
        let payload = self.data_lines.join("\n");
        let value: Option<Value> = serde_json::from_str(&payload).ok();
        if let Some(v) = value {
             // Handle content_block_start for tool_use
             if v.pointer("/content_block/type") == Some(&json!("tool_use")) {
                 let id = v.pointer("/content_block/id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                 let name = v.pointer("/content_block/name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                 return Ok(Some(vec![ToolCall { id, name, arguments: String::new() }]));
             }
             // Handle content_block_delta for partial input (arguments)
             if v.pointer("/delta/type") == Some(&json!("input_json_delta")) {
                 let args = v.pointer("/delta/partial_json").and_then(|v| v.as_str()).unwrap_or("").to_string();
                 return Ok(Some(vec![ToolCall { id: String::new(), name: String::new(), arguments: args }]));
             }
        }
        Ok(None)
    }

    /// Extract usage from message_start or message_delta event.
    pub fn extract_usage(&self) -> Result<Option<Usage>, ApiProviderError> {
        if self.data_lines.is_empty() {
            return Ok(None);
        }
        let payload = self.data_lines.join("\n");
        let value: Value = serde_json::from_str(&payload).ok().unwrap_or(json!({}));

        let usage_val = if self.event_type == "message_start" {
            value.pointer("/message/usage")
        } else if self.event_type == "message_delta" {
            value.pointer("/usage")
        } else {
            None
        };

        if let Some(v) = usage_val {
            let prompt = v
                .get("input_tokens")
                .and_then(|t| t.as_u64())
                .unwrap_or(0);
            let completion = v
                .get("output_tokens")
                .and_then(|t| t.as_u64())
                .unwrap_or(0);
            return Ok(Some(Usage {
                prompt_tokens: prompt,
                completion_tokens: completion,
                total_tokens: prompt + completion,
            }));
        }
        Ok(None)
    }
}

/// Parse one line of Anthropic SSE into current event state.
/// Returns true if a complete event was flushed (empty line separator).
pub fn parse_anthropic_line(
    line: &str,
    current_event: &mut String,
    current_data: &mut Vec<String>,
) -> bool {
    let line = line.trim_end_matches('\r');
    if line.is_empty() {
        return true; // Event boundary
    }
    if let Some(rest) = line.strip_prefix("event:") {
        *current_event = rest.trim().to_string();
        return false;
    }
    if let Some(rest) = line.strip_prefix("data:") {
        current_data.push(rest.trim().to_string());
        return false;
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_openai_line_done() {
        let mut buf = "data: [DONE]\n".to_string();
        let (content, reasoning, _tool_calls, _usage, done) = parse_openai_line(&mut buf).unwrap();
        assert!(content.is_none());
        assert!(reasoning.is_none());
        assert!(done);
    }

    #[test]
    fn test_parse_openai_line_content() {
        let mut buf = r#"data: {"choices":[{"delta":{"content":"Hello"}}]}
"#
        .to_string();
        let (content, reasoning, _tool_calls, _usage, done) = parse_openai_line(&mut buf).unwrap();
        assert_eq!(content.as_deref(), Some("Hello"));
        assert!(reasoning.is_none());
        assert!(!done);
    }
}
