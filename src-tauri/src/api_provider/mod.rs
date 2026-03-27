mod sse;

use crate::core::events::StringStream;
use futures::StreamExt;
use reqwest::Client;
use serde_json::json;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use tokio_util::sync::CancellationToken;

pub use sse::AnthropicEvent;

#[derive(Debug, Clone)]
pub struct ApiProviderMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone)]
pub enum ApiProviderError {
    Config(String),
    Execution(String),
}

impl std::fmt::Display for ApiProviderError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Config(msg) => write!(f, "{msg}"),
            Self::Execution(msg) => write!(f, "{msg}"),
        }
    }
}

impl std::error::Error for ApiProviderError {}

impl From<String> for ApiProviderError {
    fn from(message: String) -> Self {
        Self::Execution(message)
    }
}

pub trait ApiProvider: Send + Sync {
    fn id(&self) -> &str;
    #[allow(clippy::too_many_arguments)]
    fn stream_chat<'a>(
        &'a self,
        client: &'a Client,
        base_url: &'a str,
        api_key: &'a str,
        model: &'a str,
        messages: &'a [ApiProviderMessage],
        cancel_token: CancellationToken,
        on_data: &'a Arc<dyn StringStream>,
    ) -> Pin<Box<dyn Future<Output = Result<(), ApiProviderError>> + Send + 'a>>;
}

fn normalize_base_url(input: &str) -> String {
    input.trim().trim_end_matches('/').to_string()
}

fn normalize_messages(messages: &[ApiProviderMessage]) -> Vec<serde_json::Value> {
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
    messages: &[ApiProviderMessage],
    cancel_token: CancellationToken,
    on_data: &Arc<dyn StringStream>,
) -> Result<(), ApiProviderError> {
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

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut is_reasoning = false;
    loop {
        tokio::select! {
            _ = cancel_token.cancelled() => {
                if is_reasoning {
                    let _ = on_data.send_string("\n</think>\n".to_string());
                }
                return Err(ApiProviderError::Execution("请求已取消".into()));
            }
            next = stream.next() => {
                match next {
                    Some(Ok(bytes)) => {
                        let chunk = String::from_utf8_lossy(&bytes);
                        buffer.push_str(&chunk);
                        while let Some((content, reasoning, done)) = sse::parse_openai_line(&mut buffer) {
                            if done {
                                if is_reasoning {
                                    let _ = on_data.send_string("\n</think>\n".to_string());
                                }
                                return Ok(());
                            }
                            if let Some(r_text) = reasoning {
                                if !is_reasoning {
                                    is_reasoning = true;
                                    on_data.send_string(format!("<think>\n{r_text}"))?;
                                } else {
                                    on_data.send_string(r_text)?;
                                }
                            }
                            if let Some(c_text) = content {
                                if is_reasoning {
                                    is_reasoning = false;
                                    on_data.send_string(format!("\n</think>\n{c_text}"))?;
                                } else {
                                    on_data.send_string(c_text)?;
                                }
                            }
                        }
                    }
                    Some(Err(e)) => return Err(ApiProviderError::Execution(format!("读取流失败: {e}"))),
                    None => {
                        if is_reasoning {
                            let _ = on_data.send_string("\n</think>\n".to_string());
                        }
                        return Ok(());
                    }
                }
            }
        }
    }
}

fn flush_anthropic_event(
    event: &AnthropicEvent,
    on_data: &Arc<dyn StringStream>,
) -> Result<bool, ApiProviderError> {
    if event.is_complete() {
        return Ok(true);
    }
    if let Some(text) = event.extract_content()? {
        on_data.send_string(text)?;
    }
    Ok(false)
}

async fn stream_anthropic(
    client: &Client,
    base_url: &str,
    api_key: &str,
    model: &str,
    messages: &[ApiProviderMessage],
    cancel_token: CancellationToken,
    on_data: &Arc<dyn StringStream>,
) -> Result<(), ApiProviderError> {
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

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut current_event = String::new();
    let mut current_data: Vec<String> = Vec::new();
    loop {
        tokio::select! {
            _ = cancel_token.cancelled() => {
                return Err(ApiProviderError::Execution("请求已取消".into()));
            }
            next = stream.next() => {
                match next {
                    Some(Ok(bytes)) => {
                        let chunk = String::from_utf8_lossy(&bytes);
                        buffer.push_str(&chunk);
                        while let Some(pos) = buffer.find('\n') {
                            let raw_line = buffer[..pos].to_string();
                            buffer.drain(..=pos);
                            if sse::parse_anthropic_line(&raw_line, &mut current_event, &mut current_data) {
                                let event = AnthropicEvent {
                                    event_type: std::mem::take(&mut current_event),
                                    data_lines: std::mem::take(&mut current_data),
                                };
                                if flush_anthropic_event(&event, on_data)? {
                                    return Ok(());
                                }
                            }
                        }
                    }
                    Some(Err(e)) => return Err(ApiProviderError::Execution(format!("读取流失败: {e}"))),
                    None => {
                        // Process any remaining buffer (last chunk may lack trailing newline)
                        while let Some(pos) = buffer.find('\n') {
                            let raw_line = buffer[..pos].to_string();
                            buffer.drain(..=pos);
                            if sse::parse_anthropic_line(&raw_line, &mut current_event, &mut current_data) {
                                let event = AnthropicEvent {
                                    event_type: std::mem::take(&mut current_event),
                                    data_lines: std::mem::take(&mut current_data),
                                };
                                if flush_anthropic_event(&event, on_data)? {
                                    return Ok(());
                                }
                            }
                        }
                        // Handle last line without newline (e.g. "data: {...}")
                        if !buffer.is_empty() {
                            let raw_line = std::mem::take(&mut buffer);
                            if sse::parse_anthropic_line(&raw_line, &mut current_event, &mut current_data) {
                                let event = AnthropicEvent {
                                    event_type: std::mem::take(&mut current_event),
                                    data_lines: std::mem::take(&mut current_data),
                                };
                                if flush_anthropic_event(&event, on_data)? {
                                    return Ok(());
                                }
                            }
                        }
                        let event = AnthropicEvent {
                            event_type: std::mem::take(&mut current_event),
                            data_lines: std::mem::take(&mut current_data),
                        };
                        if flush_anthropic_event(&event, on_data)? {
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
        "openai"
    }

    fn stream_chat<'a>(
        &'a self,
        client: &'a Client,
        base_url: &'a str,
        api_key: &'a str,
        model: &'a str,
        messages: &'a [ApiProviderMessage],
        cancel_token: CancellationToken,
        on_data: &'a Arc<dyn StringStream>,
    ) -> Pin<Box<dyn Future<Output = Result<(), ApiProviderError>> + Send + 'a>> {
        Box::pin(stream_openai_compatible(
            client,
            base_url,
            api_key,
            model,
            messages,
            cancel_token,
            on_data,
        ))
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
        messages: &'a [ApiProviderMessage],
        cancel_token: CancellationToken,
        on_data: &'a Arc<dyn StringStream>,
    ) -> Pin<Box<dyn Future<Output = Result<(), ApiProviderError>> + Send + 'a>> {
        Box::pin(stream_anthropic(
            client,
            base_url,
            api_key,
            model,
            messages,
            cancel_token,
            on_data,
        ))
    }
}

pub struct ApiProviderRegistry {
    providers: std::collections::HashMap<String, Box<dyn ApiProvider>>,
}

impl ApiProviderRegistry {
    pub fn new() -> Self {
        let mut registry = Self {
            providers: std::collections::HashMap::new(),
        };
        registry.register(Box::new(AnthropicProvider));
        registry.register(Box::new(OpenAiProvider));
        registry
    }

    pub fn register(&mut self, provider: Box<dyn ApiProvider>) {
        self.providers.insert(provider.id().to_string(), provider);
    }

    pub fn get(&self, id: &str) -> Option<&dyn ApiProvider> {
        self.providers.get(id).map(|p| p.as_ref())
    }
}

/// Global provider registry (singleton) - avoids recreating on each stream_chat call.
static PROVIDER_REGISTRY: once_cell::sync::Lazy<ApiProviderRegistry> =
    once_cell::sync::Lazy::new(ApiProviderRegistry::new);

const API_TIMEOUT_SECS: u64 = 120;

pub async fn stream_chat(
    provider: &str,
    base_url: &str,
    api_key: &str,
    model: &str,
    messages: &[ApiProviderMessage],
    cancel_token: CancellationToken,
    on_data: Arc<dyn StringStream>,
) -> Result<(), ApiProviderError> {
    if api_key.trim().is_empty() {
        return Err(ApiProviderError::Config("API Key 未配置".into()));
    }
    if model.trim().is_empty() {
        return Err(ApiProviderError::Config("模型未配置".into()));
    }
    if base_url.trim().is_empty() {
        return Err(ApiProviderError::Config("API Base URL 未配置".into()));
    }
    let client = Client::new();
    let registry = &*PROVIDER_REGISTRY;

    let internal_provider_id = match provider {
        "openai-compatible" => "openai",
        other => other,
    };

    let p = registry
        .get(internal_provider_id)
        .ok_or_else(|| ApiProviderError::Config(format!("unsupported provider: {provider}")))?;

    let result = tokio::time::timeout(
        std::time::Duration::from_secs(API_TIMEOUT_SECS),
        p.stream_chat(
            &client,
            base_url,
            api_key,
            model,
            messages,
            cancel_token,
            &on_data,
        ),
    )
    .await;

    match result {
        Ok(Ok(())) => Ok(()),
        Ok(Err(e)) => Err(e),
        Err(_) => Err(ApiProviderError::Execution(format!(
            "API timeout after {}s",
            API_TIMEOUT_SECS
        ))),
    }
}
