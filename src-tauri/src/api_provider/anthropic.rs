use crate::core::events::StringStream;
use crate::tools::ToolDefinition;
use crate::api_provider::{ApiProvider, ApiProviderError, ApiProviderMessage, normalize_base_url};
use reqwest::Client;
use serde_json::json;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use tokio_util::sync::CancellationToken;
use super::sse::{self, AnthropicEvent};

pub struct AnthropicProvider;

impl ApiProvider for AnthropicProvider {
    fn id(&self) -> &str {
        "anthropic"
    }

    fn stream_chat<'a>(
        &'a self,
        client: &'a Client,
        base_url: &'a str,
        api_key: &'a str,
        model: &'a str,
        messages: &'a [ApiProviderMessage],
        _tools: Option<&'a [ToolDefinition]>,
        system_prompt: Option<String>,
        cancel_token: CancellationToken,
        on_data: &'a Arc<dyn StringStream>,
    ) -> Pin<Box<dyn Future<Output = Result<(), ApiProviderError>> + Send + 'a>> {
        Box::pin(stream_anthropic(
            client,
            base_url,
            api_key,
            model,
            messages,
            _tools,
            system_prompt,
            cancel_token,
            on_data,
        ))
    }
}

pub fn flush_anthropic_event(
    event: &AnthropicEvent,
    on_data: &Arc<dyn StringStream>,
) -> Result<bool, ApiProviderError> {
    if event.is_complete() {
        return Ok(true);
    }
    if let Some(text) = event.extract_content()? {
        on_data.send_string(text)?;
    }
    if let Some(reasoning) = event.extract_reasoning()? {
        on_data.send_string(format!("<think>{}</think>", reasoning))?;
    }
    if let Some(tcs) = event.extract_tool_calls()? {
        for tc in tcs {
            on_data.send_string(format!("\u{0}TOOL_CALL:{}", serde_json::to_string(&tc).unwrap_or_default()))?;
        }
    }
    if let Some(u) = event.extract_usage()? {
        on_data.send_string(format!("\u{0}TOKEN_USAGE:{}", serde_json::to_string(&u).unwrap_or_default()))?;
    }
    Ok(false)
}

pub async fn stream_anthropic(
    client: &Client,
    base_url: &str,
    api_key: &str,
    model: &str,
    messages: &[ApiProviderMessage],
    tools: Option<&[ToolDefinition]>,
    system_prompt: Option<String>,
    cancel_token: CancellationToken,
    on_data: &Arc<dyn StringStream>,
) -> Result<(), ApiProviderError> {
    let endpoint = format!("{}/v1/messages", normalize_base_url(base_url));
    let mut body = json!({
        "model": model,
        "messages": normalize_anthropic_messages(messages), 
        "max_tokens": 4096,
        "stream": true
    });

    if let Some(prompt) = system_prompt.filter(|s| !s.trim().is_empty()) {
        body["system"] = json!([
            {
                "type": "text",
                "text": prompt,
                "cache_control": {"type": "ephemeral"}
            }
        ]);
    }

    if let Some(tool_defs) = tools {
        if !tool_defs.is_empty() {
           body["tools"] = json!(tool_defs.iter().map(|t| json!({
               "name": t.name,
               "description": t.description,
               "input_schema": t.parameters
           })).collect::<Vec<_>>());
        }
    }
    let response = client
        .post(endpoint)
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("anthropic-beta", "prompt-caching-2024-07-31") // Enable Prompt Caching
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| ApiProviderError::Execution(format!("请求失败: {e}")))?;
    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(ApiProviderError::Execution(format!(
            "HTTP {}: {}",
            status.as_u16(),
            text
        )));
    }

    let mut current_event = String::new();
    let mut current_data: Vec<String> = Vec::new();

    crate::api_provider::sse_util::process_sse_stream(response, cancel_token, |line| {
        if sse::parse_anthropic_line(line, &mut current_event, &mut current_data) {
            let event = AnthropicEvent {
                event_type: std::mem::take(&mut current_event),
                data_lines: std::mem::take(&mut current_data),
            };
            if flush_anthropic_event(&event, on_data)? {
                return Ok(true);
            }
        }
        Ok(false)
    }).await?;

    Ok(())
}

pub fn normalize_anthropic_messages(
    messages: &[ApiProviderMessage],
) -> Vec<serde_json::Value> {
    let mut out = Vec::new();
    for m in messages {
        let role = match m.role.as_str() {
            "assistant" => "assistant",
            _ => "user", // Anthropic expects user/assistant only in messages array
        };
        let content_text = m.content.trim();
        
        let content_value = if let Some(attachments) = &m.attachments {
            if attachments.is_empty() {
                json!(content_text)
            } else {
                let mut parts = Vec::new();
                if !content_text.is_empty() {
                    parts.push(json!({
                        "type": "text",
                        "text": content_text
                    }));
                }
                for att in attachments {
                    if att.mime_type.starts_with("image/") {
                        parts.push(json!({
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": att.mime_type,
                                "data": att.data
                            }
                        }));
                    }
                }
                json!(parts)
            }
        } else {
            json!(content_text)
        };

        let msg = json!({
            "role": role,
            "content": content_value
        });
        
        out.push(msg);
    }
    out
}
