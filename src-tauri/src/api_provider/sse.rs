//! SSE (Server-Sent Events) parsing for streaming API responses.
//! Extracted from provider-specific logic for reuse and testability.

use serde_json::Value;

/// Parse OpenAI-compatible SSE format: `data: {...}` or `data: [DONE]`.
/// Returns (content_opt, is_done).
/// Modifies buffer in place, consuming parsed lines.
pub fn parse_openai_line(buffer: &mut String) -> Option<(Option<String>, Option<String>, bool)> {
    let pos = buffer.find('\n')?;
    let line = buffer[..pos].to_string();
    buffer.drain(..=pos);
    let trimmed = line.trim();
    if !trimmed.starts_with("data:") {
        return Some((None, None, false));
    }
    let payload = trimmed.trim_start_matches("data:").trim();
    if payload == "[DONE]" {
        return Some((None, None, true));
    }
    let value: Value = serde_json::from_str(payload).ok()?;
    let text = value
        .pointer("/choices/0/delta/content")
        .and_then(|v| v.as_str())
        .or_else(|| value.pointer("/choices/0/delta/content/0/text").and_then(|v| v.as_str()));
    let content = text.filter(|s| !s.is_empty()).map(|s| s.to_string());

    let reasoning_text = value
        .pointer("/choices/0/delta/reasoning_content")
        .and_then(|v| v.as_str());
    let reasoning = reasoning_text.filter(|s| !s.is_empty()).map(|s| s.to_string());

    Some((content, reasoning, false))
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
    pub fn extract_content(&self) -> Result<Option<String>, String> {
        if self.event_type == "message_stop" {
            return Ok(None);
        }
        if self.data_lines.is_empty() {
            return Ok(None);
        }
        let payload = self.data_lines.join("\n");
        let value: Value =
            serde_json::from_str(&payload).map_err(|e| format!("解析响应失败: {e}"))?;
        let text = if self.event_type == "content_block_delta" {
            value.pointer("/delta/text").and_then(|v| v.as_str())
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
        let (content, reasoning, done) = parse_openai_line(&mut buf).unwrap();
        assert!(content.is_none());
        assert!(reasoning.is_none());
        assert!(done);
    }

    #[test]
    fn test_parse_openai_line_content() {
        let mut buf = r#"data: {"choices":[{"delta":{"content":"Hello"}}]}
"#.to_string();
        let (content, reasoning, done) = parse_openai_line(&mut buf).unwrap();
        assert_eq!(content.as_deref(), Some("Hello"));
        assert!(reasoning.is_none());
        assert!(!done);
    }
}
