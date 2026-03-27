use crate::core::events::StringStream;
use crate::plugin_engine::api_chat_runner;
use crate::plugin_engine::cli_chat_runner;
use crate::plugin_engine::EngineError;
use crate::workflow::types::{ChatApiMessage, VerificationSummary};
use futures::Future;
use std::pin::Pin;
use std::sync::Arc;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone)]
pub struct ApiChatRequest {
    pub provider: String,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub messages: Vec<ChatApiMessage>,
}

#[derive(Debug, Clone)]
pub struct CliChatRequest {
    pub command: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub env: Vec<(String, String)>,
}

#[derive(Debug, Clone)]
pub struct CliChatOutput {
    pub exit_code: Option<i32>,
    pub output_snapshot: String,
    pub verification: Option<VerificationSummary>,
}

pub trait MaestroEngine: Send + Sync {
    fn run_api_chat<'a>(
        &'a self,
        request: ApiChatRequest,
        cancel_token: CancellationToken,
        on_data: Arc<dyn StringStream>,
    ) -> Pin<Box<dyn Future<Output = Result<(), EngineError>> + Send + 'a>>;
    fn run_cli_chat<'a>(
        &'a self,
        request: CliChatRequest,
        cancel_token: CancellationToken,
        on_data: Arc<dyn StringStream>,
    ) -> Pin<Box<dyn Future<Output = Result<CliChatOutput, EngineError>> + Send + 'a>>;
}

#[derive(Default)]
pub struct DefaultMaestroEngine;

impl MaestroEngine for DefaultMaestroEngine {
    fn run_api_chat<'a>(
        &'a self,
        request: ApiChatRequest,
        cancel_token: CancellationToken,
        on_data: Arc<dyn StringStream>,
    ) -> Pin<Box<dyn Future<Output = Result<(), EngineError>> + Send + 'a>> {
        Box::pin(api_chat_runner::run_api_chat(
            request,
            cancel_token,
            on_data,
        ))
    }

    fn run_cli_chat<'a>(
        &'a self,
        request: CliChatRequest,
        cancel_token: CancellationToken,
        on_data: Arc<dyn StringStream>,
    ) -> Pin<Box<dyn Future<Output = Result<CliChatOutput, EngineError>> + Send + 'a>> {
        Box::pin(cli_chat_runner::run_cli_chat(
            request,
            cancel_token,
            on_data,
        ))
    }
}
