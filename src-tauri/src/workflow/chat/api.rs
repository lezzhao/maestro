use crate::agent_state::AppEventHandle;
use crate::config::AppConfig;
use crate::core::error::CoreError;
use crate::core::events::StringStream;
use crate::core::execution::{Execution, ExecutionMode, ExecutionStatus};
use crate::headless::HeadlessProcessState;
use crate::plugin_engine::maestro_engine::{ApiChatRequest, DefaultMaestroEngine, MaestroEngine};
use crate::storage::run_persistence::current_time_ms;
use crate::infra::workspace_io::WorkspaceIo;
use super::super::types::{ChatApiRequest, ChatExecuteApiResult};
use super::super::execution_lifecycle::ExecutionLifecycle;
use std::sync::Arc;
use tokio_util::sync::CancellationToken;

pub async fn chat_execute_api_core(
    event_handle: Arc<dyn AppEventHandle>,
    core: Arc<crate::core::MaestroCore>,
    request: ChatApiRequest,
    cfg: AppConfig,
    headless_state: &HeadlessProcessState,
    on_data: Arc<dyn StringStream>,
) -> Result<ChatExecuteApiResult, CoreError> {
    let (execution_id, resolved) = {
        let prepared = crate::storage::execution_binding::resolve_execution(
            event_handle.clone(),
            &request.engine_id,
            request.profile_id.as_deref(),
            "api",
            request.task_id.as_deref(),
            "chat_api",
            &cfg,
        )?;
        let id = prepared
            .execution_id
            .unwrap_or_else(|| format!("chat-api-{}-{}", request.engine_id, uuid::Uuid::new_v4()));
        (id, prepared.context)
    };
    let cycle_id = uuid::Uuid::new_v4().to_string();
    let exec = resolved.to_execution_config();

    let provider = exec
        .api_provider
        .clone()
        .unwrap_or_else(|| "openai-compatible".to_string());
    let base_url = exec.api_base_url.clone().unwrap_or_default();
    let api_key = exec.api_key.clone().unwrap_or_default();
    let model = exec.model.clone().unwrap_or_default();
    let command = exec.command.clone();
    let engine_id = resolved.engine_id.clone();
    let profile_id = resolved
        .profile_id
        .clone()
        .unwrap_or_else(|| "default".to_string());
    let (messages, message_ids) = (request.messages.clone(), request.message_ids.clone());
    let cancel_token = CancellationToken::new();
    let runtime_engine = DefaultMaestroEngine;
    let task_id = request.task_id.clone().unwrap_or_default();

    let now_ms = current_time_ms().unwrap_or_default();
    let execution = Execution {
        id: execution_id.clone(),
        engine_id: engine_id.to_string(),
        task_id: task_id.clone(),
        source: "chat_execute_api".to_string(),
        mode: ExecutionMode::Api,
        status: ExecutionStatus::Running,
        command: command.clone(),
        cwd: cfg.project.path.clone(),
        model: model.clone(),
        created_at: now_ms,
        updated_at: now_ms,
        log_path: None,
        output_preview: String::new(),
        verification: None,
        error: None,
        result: None,
        native_ref: None,
    };

    let on_data_with_state = Arc::new(crate::core::events::StateUpdateStream {
        inner: on_data.clone(),
        event_handle: event_handle.clone(),
        task_id: task_id.clone(),
        run_id: execution_id.clone(),
        state_token: request.state_token.clone(),
    });

    let root_path = std::path::PathBuf::from(&cfg.project.path);
    let io_opt = WorkspaceIo::new(&root_path).ok();
    
    let lifecycle = ExecutionLifecycle::new(
        event_handle.clone(),
        headless_state,
        execution,
        cancel_token.clone(),
        cycle_id.clone(),
        on_data,
        io_opt,
        Some(api_key.clone()),
        request.state_token.clone(),
    );

    let res_cycle_id = cycle_id.clone();
    let res_exec_id = execution_id.clone();
    tokio::spawn(async move {
        let run_result = runtime_engine
            .run_api_chat(
                event_handle,
                core,
                ApiChatRequest {
                    provider,
                    base_url,
                    api_key,
                    model,
                    messages,
                    system_prompt: None,
                    pinned_files: request.pinned_files.unwrap_or_default(),
                    task_id: Some(task_id),
                    conversation_id: request.conversation_id,
                    message_ids,
                    run_id: Some(execution_id),
                    cycle_id: Some(cycle_id),
                    state_token: request.state_token.clone(),
                    attachments: request.attachments,
                },
                cancel_token,
                on_data_with_state,
            )
            .await;

        lifecycle.finish(run_result, String::new(), None);
    });

    Ok(ChatExecuteApiResult {
        exec_id: res_exec_id.clone(),
        run_id: res_exec_id,
        cycle_id: res_cycle_id,
        engine_id,
        profile_id,
    })
}
