use crate::core::events::StringStream;
use crate::plugin_engine::maestro_engine::ApiChatRequest;
use crate::plugin_engine::EngineError;
use crate::plugin_engine::orchestrator::AgentOrchestrator;
use crate::core::MaestroCore;
use crate::agent_state::AppEventHandle;
use tokio_util::sync::CancellationToken;
use std::sync::Arc;

pub async fn run_api_chat(
    event_handle: Arc<dyn AppEventHandle>,
    core: Arc<MaestroCore>,
    request: ApiChatRequest,
    cancel_token: CancellationToken,
    on_data: Arc<dyn StringStream>,
) -> Result<String, EngineError> {
    // 1. Sync MCP servers with latest config before running
    // This ensures that any config changes are reflected in the persistent service.
    let config = core.config.get();
    if let Err(e) = core.mcp_service.sync_with_config(&config).await {
        let _ = on_data.send_string(format!("\u{0}NOTICE:MCP Sync Error: {e}"));
    }

    // 2. Initialize Orchestrator
    let mut orchestrator = AgentOrchestrator::prepare(
        event_handle,
        core.clone(),
        request,
        cancel_token.clone(),
        on_data.clone(),
    ).await?;

    // 3. Acquire Execution Permit (Task Queue concurrency control)
    let _permit = core.run_queue.acquire().await.map_err(|e| EngineError::Execution(e))?;

    // 4. Start watchdog to enforce maximum execution time (10 minutes)
    let _enforcer = crate::core::completion_enforcer::CompletionEnforcer::spawn(
        std::time::Duration::from_secs(600),
        cancel_token,
    );

    // 5. Execute the interaction loop
    orchestrator.run().await
}
