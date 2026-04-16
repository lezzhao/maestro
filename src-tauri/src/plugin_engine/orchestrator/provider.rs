use crate::api_provider::{self, ApiProviderMessage};
use crate::core::events::StringStream;
use crate::tools::ToolDefinition;
use crate::plugin_engine::EngineError;
use std::sync::Arc;
use tokio_util::sync::CancellationToken;
use async_trait::async_trait;

#[async_trait]
pub trait LlmProvider: Send + Sync {
    async fn stream_chat(
        &self,
        base_url: &str,
        api_key: &str,
        model: &str,
        messages: &[ApiProviderMessage],
        tools: Option<&[ToolDefinition]>,
        system_prompt: Option<String>,
        cancel_token: CancellationToken,
        on_data: &Arc<dyn StringStream>,
    ) -> Result<(), EngineError>;
}

pub struct DefaultLlmProvider;

#[async_trait]
impl LlmProvider for DefaultLlmProvider {
    async fn stream_chat(
        &self,
        base_url: &str,
        api_key: &str,
        model: &str,
        messages: &[ApiProviderMessage],
        tools: Option<&[ToolDefinition]>,
        system_prompt: Option<String>,
        cancel_token: CancellationToken,
        on_data: &Arc<dyn StringStream>,
    ) -> Result<(), EngineError> {
        api_provider::stream_chat(
            "openai-compatible", // 目前默认走兼容路径，内部会根据 ID 自动路由
            base_url,
            api_key,
            model,
            messages,
            tools,
            system_prompt,
            cancel_token,
            on_data,
        )
        .await
        .map_err(|e| EngineError::Execution(e.to_string()))
    }
}

pub fn create_provider(provider_type: &str) -> Box<dyn LlmProvider> {
    match provider_type {
        _ => Box::new(DefaultLlmProvider),
    }
}


