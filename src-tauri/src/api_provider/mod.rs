pub mod sse;
pub mod sse_util;
pub mod openai;
pub mod anthropic;

use crate::core::events::StringStream;
use crate::tools::{ToolCall, ToolDefinition};
use reqwest::Client;
use serde_json::json;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use tokio::sync::Mutex as TokioMutex;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone)]
pub struct ApiProviderAttachment {
    #[allow(dead_code)]
    pub name: String,
    pub mime_type: String,
    pub data: String, // Base64
}

#[derive(Debug, Clone)]
pub struct ApiProviderMessage {
    pub role: String,
    pub content: String,
    pub attachments: Option<Vec<ApiProviderAttachment>>,
    pub tool_calls: Option<Vec<ToolCall>>,
    pub tool_call_id: Option<String>, // for "tool" role
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
        tools: Option<&'a [ToolDefinition]>,
        system_prompt: Option<String>,
        cancel_token: CancellationToken,
        on_data: &'a Arc<dyn StringStream>,
    ) -> Pin<Box<dyn Future<Output = Result<(), ApiProviderError>> + Send + 'a>>;

    #[allow(clippy::too_many_arguments)]
    #[allow(dead_code)]
    fn chat<'a>(
        &'a self,
        client: &'a Client,
        base_url: &'a str,
        api_key: &'a str,
        model: &'a str,
        messages: &'a [ApiProviderMessage],
        tools: Option<&'a [ToolDefinition]>,
        system_prompt: Option<String>,
    ) -> Pin<Box<dyn Future<Output = Result<String, ApiProviderError>> + Send + 'a>> {
        let cancel_token = CancellationToken::new();
        let collector = Arc::new(BufferedStringStream::new());
        let collector_clone = collector.clone();
        
        Box::pin(async move {
            self.stream_chat(
                client, 
                base_url, 
                api_key, 
                model, 
                messages, 
                tools, 
                system_prompt, 
                cancel_token, 
                &(collector_clone as Arc<dyn StringStream>)
            ).await?;
            Ok(collector.get_full_text().await)
        })
    }
}

/// A StringStream adapter that buffers all streamed text for later retrieval.
#[allow(dead_code)]
pub struct BufferedStringStream {
    buffer: TokioMutex<String>,
}

impl BufferedStringStream {
    #[allow(dead_code)]
    pub fn new() -> Self {
        Self {
            buffer: TokioMutex::new(String::new()),
        }
    }

    #[allow(dead_code)]
    pub async fn get_full_text(&self) -> String {
        self.buffer.lock().await.clone()
    }
}

impl StringStream for BufferedStringStream {
    fn send_string(&self, data: String) -> Result<(), String> {
        // Use try_lock since we're in a sync context
        match self.buffer.try_lock() {
            Ok(mut buf) => {
                buf.push_str(&data);
                Ok(())
            }
            Err(_) => Ok(()), // Skip if lock contention (unlikely)
        }
    }
}

pub fn normalize_base_url(input: &str) -> String {
    input.trim().trim_end_matches('/').to_string()
}

pub fn normalize_messages(
    messages: &[ApiProviderMessage],
    system_prompt: Option<String>,
) -> Vec<serde_json::Value> {
    let mut out = Vec::new();
    if let Some(prompt) = system_prompt {
        if !prompt.trim().is_empty() {
            out.push(json!({
                "role": "system",
                "content": prompt.trim()
            }));
        }
    }
    for m in messages {
        let role = m.role.trim();
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
                            "type": "image_url",
                            "image_url": {
                                "url": format!("data:{};base64,{}", att.mime_type, att.data)
                            }
                        }));
                    }
                }
                json!(parts)
            }
        } else {
            json!(content_text)
        };

        let mut msg = json!({
            "role": role,
            "content": content_value
        });

        if let Some(tool_calls) = &m.tool_calls {
            let tc_json = tool_calls.iter().map(|tc| json!({
                "id": tc.id,
                "type": "function",
                "function": {
                    "name": tc.name,
                    "arguments": tc.arguments
                }
            })).collect::<Vec<_>>();
            msg["tool_calls"] = serde_json::Value::Array(tc_json);
        }

        if let Some(tid) = &m.tool_call_id {
            msg["tool_call_id"] = json!(tid);
        }

        out.push(msg);
    }
    out
}

pub struct ApiProviderRegistry {
    providers: std::collections::HashMap<String, Box<dyn ApiProvider>>,
}

impl ApiProviderRegistry {
    pub fn new() -> Self {
        let mut registry = Self {
            providers: std::collections::HashMap::new(),
        };
        registry.register(Box::new(anthropic::AnthropicProvider));
        registry.register(Box::new(openai::OpenAiProvider));
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
    tools: Option<&[ToolDefinition]>,
    system_prompt: Option<String>,
    cancel_token: CancellationToken,
    on_data: &Arc<dyn StringStream>,
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
            tools,
            system_prompt,
            cancel_token,
            on_data,
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
