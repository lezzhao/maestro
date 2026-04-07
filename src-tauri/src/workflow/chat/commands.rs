use tauri::{command, AppHandle, State, ipc::Channel};
use crate::agent_state::TauriEventHandle;
use crate::core::error::CoreError;
use crate::core::events::ChannelStringStream;
use super::super::types::*;
use super::api::chat_execute_api_core;
use super::cli::chat_execute_cli_core;
use super::persistence::{chat_save_last_conversation_core, chat_load_last_conversation_core};
use std::sync::Arc;

#[command]
pub async fn chat_save_last_conversation(
    app: AppHandle,
    payload: serde_json::Value,
    _core_state: State<'_, Arc<crate::core::MaestroCore>>,
) -> Result<(), CoreError> {
    chat_save_last_conversation_core(TauriEventHandle::arc(app), payload).await
}

#[command]
pub async fn chat_load_last_conversation(
    app: AppHandle,
    _core_state: State<'_, Arc<crate::core::MaestroCore>>,
) -> Result<Option<serde_json::Value>, CoreError> {
    chat_load_last_conversation_core(TauriEventHandle::arc(app)).await
}

#[command]
pub async fn chat_execute_api(
    app: AppHandle,
    request: ChatApiRequest,
    core_state: State<'_, Arc<crate::core::MaestroCore>>,
    on_data: Channel<String>,
) -> Result<ChatExecuteApiResult, CoreError> {
    let core = core_state.inner().clone();
    let cfg = core.config.get();
    let headless = core.headless_state.clone();
    chat_execute_api_core(
        TauriEventHandle::arc(app),
        core,
        request,
        (*cfg).clone(),
        &headless,
        Arc::new(ChannelStringStream(on_data)),
    )
    .await
}

#[command]
pub fn chat_submit_choice(
    app: AppHandle,
    request: ChatSubmitChoiceRequest,
    core_state: State<'_, Arc<crate::core::MaestroCore>>,
) -> Result<(), CoreError> {
    let cfg = core_state.config.get();
    let i18n = cfg.i18n();

    crate::agent_state::emit_state_update(
        Some(&app),
        crate::agent_state::resolve_choice_payload(
            request.task_id.clone(),
            request.message_id.clone(),
            request.option_id.clone(),
        ),
        None,
    );
    crate::agent_state::emit_state_update(
        Some(&app),
        crate::agent_state::append_system_message_payload(
            request.task_id,
            i18n.t("choice_selected").replace("{}", &request.option_label),
            Some(serde_json::json!({
                "eventType": "notice",
                "eventStatus": "done",
                "toolName": "choice",
                "messageId": request.message_id,
                "optionId": request.option_id,
            })),
        ),
        None,
    );
    Ok(())
}

#[command]
pub fn chat_execute_api_stop(
    request: ChatExecuteStopRequest,
    core_state: State<'_, Arc<crate::core::MaestroCore>>,
) -> Result<(), CoreError> {
    core_state.inner().cancel_execution(
        crate::core::execution_app_service::CancelTarget::ExecutionId(request.exec_id.clone()),
    )
}

#[command]
pub async fn chat_execute_cli(
    app: AppHandle,
    request: ChatExecuteCliRequest,
    core_state: State<'_, Arc<crate::core::MaestroCore>>,
    on_data: Channel<String>,
) -> Result<ChatExecuteCliResult, CoreError> {
    let core = core_state.inner().clone();
    let cfg = (*core.config.get()).clone();
    let event_handle = TauriEventHandle::arc(app);
    let on_data_stream = Arc::new(ChannelStringStream(on_data));
    
    chat_execute_cli_core(
        event_handle,
        core.clone(),
        request,
        cfg,
        &core.headless_state,
        on_data_stream,
    )
    .await
}

#[command]
pub fn chat_execute_cli_stop(
    request: ChatExecuteStopRequest,
    core_state: State<'_, Arc<crate::core::MaestroCore>>,
) -> Result<(), CoreError> {
    core_state.inner().cancel_execution(
        crate::core::execution_app_service::CancelTarget::ExecutionId(request.exec_id.clone()),
    )
}

#[command]
pub fn chat_spawn(
    app: AppHandle,
    request: ChatSpawnRequest,
    core_state: State<'_, Arc<crate::core::MaestroCore>>,
    on_data: Channel<String>,
) -> Result<ChatSessionMeta, CoreError> {
    let core = core_state.inner();
    super::pty::chat_spawn_core(
        TauriEventHandle::arc(app),
        request,
        &*core.config.get(),
        &core.pty_state,
        on_data,
    )
}

#[command]
pub fn chat_send(
    request: ChatSendRequest,
    core_state: State<'_, Arc<crate::core::MaestroCore>>,
) -> Result<(), CoreError> {
    let payload = if request.append_newline.unwrap_or(true) {
        format!("{}\n", request.content)
    } else {
        request.content
    };
    core_state
        .inner()
        .pty_write(request.session_id.clone(), payload)
        .map_err(|e| CoreError::ExecutionFailed {
            id: request.session_id.clone(),
            reason: e.to_string(),
        })
}

#[command]
pub fn chat_stop(
    request: ChatStopRequest,
    core_state: State<'_, Arc<crate::core::MaestroCore>>,
) -> Result<(), CoreError> {
    core_state
        .inner()
        .pty_kill(request.session_id.clone())
        .map_err(|e| CoreError::ExecutionFailed {
            id: request.session_id.clone(),
            reason: e.to_string(),
        })
}

#[command]
pub async fn chat_resolve_pending_tool(
    core_state: State<'_, Arc<crate::core::MaestroCore>>,
    request_id: String,
    approved: bool,
    edited_arguments: Option<String>,
) -> Result<(), CoreError> {
    core_state.safety_manager.resolve_approval(&request_id, approved, edited_arguments).await;
    Ok(())
}

#[command]
pub async fn chat_resolve_pending_question(
    core_state: State<'_, Arc<crate::core::MaestroCore>>,
    request_id: String,
    selected_options: Vec<String>,
    custom_text: Option<String>,
    denied: bool,
) -> Result<(), CoreError> {
    core_state.safety_manager.resolve_question(&request_id, crate::safety::QuestionResponse {
        selected_options,
        custom_text,
        denied,
    }).await;
    Ok(())
}

#[command]
pub fn ui_session_init(app: AppHandle) -> Result<(), CoreError> {
    if let Some(core) = app.try_state::<Arc<crate::core::MaestroCore>>() {
        core.safety_manager.inc_ui_sessions();
        tracing::info!(count = core.safety_manager.get_active_ui_sessions(), "UI session initialized");
        Ok(())
    } else {
        // Core not ready yet, this is acceptable during early startup
        tracing::warn!("UI session init called before core ready");
        Ok(())
    }
}

#[command]
pub fn ui_session_destroy(app: AppHandle) -> Result<(), CoreError> {
    if let Some(core) = app.try_state::<Arc<crate::core::MaestroCore>>() {
        core.safety_manager.dec_ui_sessions();
        tracing::info!(count = core.safety_manager.get_active_ui_sessions(), "UI session destroyed");
        Ok(())
    } else {
        Ok(())
    }
}
