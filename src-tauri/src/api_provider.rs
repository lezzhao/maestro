use crate::workflow::types::ChatApiMessage;
use futures::StreamExt;
use reqwest::Client;
use serde_json::json;
use crate::core::events::StringStream;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use tokio::sync::oneshot;

pub trait ApiProvider: Send + Sync {
    fn id(&self) -> &str;
    fn stream_chat<'a>(
        &'a self,
        client: &'a Client,
        base_url: &'a str,
        api_key: &'a str,
        model: &'a str,
        messages: &'a [ChatApiMessage],
        cancel_rx: &'a mut oneshot::Receiver<()>,
        on_data: &'a Arc<dyn StringStream>,
    ) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + 'a>>;
}

fn normalize_base_url(input: &str) -> String {
    input.trim().trim_end_matches('/').to_string()
}

fn normalize_messages(messages: &[ChatApiMessage]) -> Vec<serde_json::Value> {
    messages
        .iter()
        .filter_map(|m| {
            let role = m.role.trim();
            let content = m.content.trim();
            if role.is_empty() || content.is_empty() {
                return None;
            }
            Some(json!({
                "role": role,
                "content": content
            }))
        })
        .collect()
}

async fn stream_openai_compatible(
    client: &Client,
    base_url: &str,
    api_key: &str,
    model: &str,
    messages: &[ChatApiMessage],
    cancel_rx: &mut oneshot::Receiver<()>,
    on_data: &Arc<dyn StringStream>,
) -> Result<(), String> {
    let endpoint = format!("{}/chat/completions", normalize_base_url(base_url));
    let body = json!({
        "model": model,
        "messages": normalize_messages(messages),
        "stream": true
    });
    let response = client
        .post(endpoint)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("请求失败: {e}"))?;
    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("HTTP {}: {}", status.as_u16(), text));
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    loop {
        tokio::select! {
            _ = &mut *cancel_rx => {
                return Err("请求已取消".to_string());
            }
            next = stream.next() => {
                match next {
                    Some(Ok(bytes)) => {
                        let chunk = String::from_utf8_lossy(&bytes);
                        buffer.push_str(&chunk);
                        while let Some(pos) = buffer.find('\n') {
                            let line = buffer[..pos].to_string();
                            buffer.drain(..=pos);
                            let trimmed = line.trim();
                            if !trimmed.starts_with("data:") {
                                continue;
                            }
                            let payload = trimmed.trim_start_matches("data:").trim();
                            if payload == "[DONE]" {
                                return Ok(());
                            }
                            let value: serde_json::Value = match serde_json::from_str(payload) {
                                Ok(v) => v,
                                Err(_) => continue,
                            };
                            if let Some(text) = value.pointer("/choices/0/delta/content").and_then(|v| v.as_str()) {
                                if !text.is_empty() {
                                    let _ = on_data.send_string(text.to_string());
                                }
                            } else if let Some(text) = value.pointer("/choices/0/delta/content/0/text").and_then(|v| v.as_str()) {
                                if !text.is_empty() {
                                    let _ = on_data.send_string(text.to_string());
                                }
                            }
                        }
                    }
                    Some(Err(e)) => return Err(format!("读取流失败: {e}")),
                    None => return Ok(()),
                }
            }
        }
    }
}

fn flush_anthropic_event(
    event_name: &str,
    data_lines: &[String],
    on_data: &Arc<dyn StringStream>,
) -> Result<bool, String> {
    if event_name == "message_stop" {
        return Ok(true);
    }
    if data_lines.is_empty() {
        return Ok(false);
    }
    let payload = data_lines.join("\n");
    let value: serde_json::Value =
        serde_json::from_str(&payload).map_err(|e| format!("解析响应失败: {e}"))?;
    if event_name == "content_block_delta" {
        if let Some(text) = value.pointer("/delta/text").and_then(|v| v.as_str()) {
            if !text.is_empty() {
                let _ = on_data.send_string(text.to_string());
            }
        }
    } else if event_name.is_empty() {
        if let Some(event_type) = value.pointer("/type").and_then(|v| v.as_str()) {
            if event_type == "message_stop" {
                return Ok(true);
            }
            if event_type == "content_block_delta" {
                if let Some(text) = value.pointer("/delta/text").and_then(|v| v.as_str()) {
                    if !text.is_empty() {
                        let _ = on_data.send_string(text.to_string());
                    }
                }
            }
        }
    }
    Ok(false)
}

async fn stream_anthropic(
    client: &Client,
    base_url: &str,
    api_key: &str,
    model: &str,
    messages: &[ChatApiMessage],
    cancel_rx: &mut oneshot::Receiver<()>,
    on_data: &Arc<dyn StringStream>,
) -> Result<(), String> {
    let endpoint = format!("{}/v1/messages", normalize_base_url(base_url));
    let body = json!({
        "model": model,
        "messages": normalize_messages(messages),
        "max_tokens": 4096,
        "stream": true
    });
    let response = client
        .post(endpoint)
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("请求失败: {e}"))?;
    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("HTTP {}: {}", status.as_u16(), text));
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut current_event = String::new();
    let mut current_data: Vec<String> = Vec::new();
    loop {
        tokio::select! {
            _ = &mut *cancel_rx => {
                return Err("请求已取消".to_string());
            }
            next = stream.next() => {
                match next {
                    Some(Ok(bytes)) => {
                        let chunk = String::from_utf8_lossy(&bytes);
                        buffer.push_str(&chunk);
                        while let Some(pos) = buffer.find('\n') {
                            let raw_line = buffer[..pos].to_string();
                            buffer.drain(..=pos);
                            let line = raw_line.trim_end_matches('\r');
                            if line.is_empty() {
                                if flush_anthropic_event(&current_event, &current_data, on_data)? {
                                    return Ok(());
                                }
                                current_event.clear();
                                current_data.clear();
                                continue;
                            }
                            if let Some(rest) = line.strip_prefix("event:") {
                                current_event = rest.trim().to_string();
                                continue;
                            }
                            if let Some(rest) = line.strip_prefix("data:") {
                                current_data.push(rest.trim().to_string());
                            }
                        }
                    }
                    Some(Err(e)) => return Err(format!("读取流失败: {e}")),
                    None => {
                        if flush_anthropic_event(&current_event, &current_data, on_data)? {
                            return Ok(());
                        }
                        return Ok(());
                    }
                }
            }
        }
    }
}

pub struct OpenAiProvider;

impl ApiProvider for OpenAiProvider {
    fn id(&self) -> &str {
        "openai" // Or rather, generic compatible
    }

    fn stream_chat<'a>(
        &'a self,
        client: &'a Client,
        base_url: &'a str,
        api_key: &'a str,
        model: &'a str,
        messages: &'a [ChatApiMessage],
        cancel_rx: &'a mut oneshot::Receiver<()>,
        on_data: &'a Arc<dyn StringStream>,
    ) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + 'a>> {
        Box::pin(stream_openai_compatible(client, base_url, api_key, model, messages, cancel_rx, on_data))
    }
}

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
        messages: &'a [ChatApiMessage],
        cancel_rx: &'a mut oneshot::Receiver<()>,
        on_data: &'a Arc<dyn StringStream>,
    ) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + 'a>> {
        Box::pin(stream_anthropic(client, base_url, api_key, model, messages, cancel_rx, on_data))
    }
}

pub struct ApiProviderRegistry {
    providers: Vec<Box<dyn ApiProvider>>,
}

impl ApiProviderRegistry {
    pub fn new() -> Self {
        Self {
            providers: vec![
                Box::new(AnthropicProvider),
                Box::new(OpenAiProvider),
            ],
        }
    }

    pub fn get(&self, id: &str) -> Option<&dyn ApiProvider> {
        if id == "anthropic" {
            self.providers.iter().find(|p| p.id() == "anthropic").map(|p| p.as_ref())
        } else {
            // default to openai compatible
            self.providers.iter().find(|p| p.id() == "openai").map(|p| p.as_ref())
        }
    }
}

pub async fn stream_chat(
    provider: &str,
    base_url: &str,
    api_key: &str,
    model: &str,
    messages: &[ChatApiMessage],
    mut cancel_rx: oneshot::Receiver<()>,
    on_data: Arc<dyn StringStream>,
) -> Result<(), String> {
    if api_key.trim().is_empty() {
        return Err("API Key 未配置".to_string());
    }
    if model.trim().is_empty() {
        return Err("模型未配置".to_string());
    }
    if base_url.trim().is_empty() {
        return Err("API Base URL 未配置".to_string());
    }
    let client = Client::new();
    let registry = ApiProviderRegistry::new();
    let p = registry.get(provider).ok_or_else(|| format!("unsupported provider: {provider}"))?;
    p.stream_chat(
        &client,
        base_url,
        api_key,
        model,
        messages,
        &mut cancel_rx,
        &on_data,
    ).await
}
