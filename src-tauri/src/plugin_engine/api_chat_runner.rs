use crate::api_provider;
use crate::api_provider::{ApiProviderError, ApiProviderMessage};
use crate::core::events::StringStream;
use crate::plugin_engine::maestro_engine::ApiChatRequest;
use crate::plugin_engine::EngineError;
use tokio_util::sync::CancellationToken;

use std::sync::Arc;

fn map_api_provider_error(error: ApiProviderError) -> EngineError {
    match error {
        ApiProviderError::Config(message) => EngineError::Config(message),
        ApiProviderError::Execution(message) => EngineError::Execution(message),
    }
}

fn to_api_provider_messages(
    messages: Vec<crate::workflow::types::ChatApiMessage>,
) -> Vec<ApiProviderMessage> {
    messages
        .into_iter()
        .map(|message| ApiProviderMessage {
            role: message.role,
            content: message.content,
        })
        .collect()
}

pub async fn run_api_chat(
    request: ApiChatRequest,
    cancel_token: CancellationToken,
    on_data: Arc<dyn StringStream>,
) -> Result<(), EngineError> {
    let ApiChatRequest {
        provider,
        base_url,
        api_key,
        model,
        messages,
    } = request;
    let provider_messages = to_api_provider_messages(messages);
    api_provider::stream_chat(
        &provider,
        &base_url,
        &api_key,
        &model,
        &provider_messages,
        cancel_token,
        on_data,
    )
    .await
    .map_err(map_api_provider_error)
}
