use super::types::*;
use super::util::{completion_matched, with_model_args};
use crate::agent_state::{
    build_choice_meta, AppEventHandle, ChoiceAction, ChoiceOption, ChoicePayload, TauriEventHandle,
};
use crate::config::AppConfig;
use crate::core::error::CoreError;
use crate::core::events::{ChannelStringStream, StringStream};
use crate::core::execution::{Execution, ExecutionMode, ExecutionStatus};
use crate::headless::HeadlessProcessState;
use crate::plugin_engine::maestro_engine::{
    ApiChatRequest, CliChatRequest, DefaultMaestroEngine, MaestroEngine,
};
use crate::pty::PtySessionInfo;
use crate::run_persistence::{append_run_record, current_time_ms};
use crate::workspace_io::WorkspaceIo;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{
    command,
    ipc::{Channel, InvokeResponseBody},
    AppHandle, State,
};
use tokio_util::sync::CancellationToken;

async fn last_conversation_path_core() -> Result<PathBuf, CoreError> {
    let home = dirs::home_dir().ok_or_else(|| CoreError::Io {
        message: "Could not find home directory".to_string(),
    })?;
    let dir = home.join(".maestro");
    if !dir.exists() {
        tokio::fs::create_dir_all(&dir)
            .await
            .map_err(|e| CoreError::Io {
                message: format!("create .maestro dir failed: {e}"),
            })?;
    }
    Ok(dir.join("last-conversation.json"))
}

fn engine_supports_continue(engine_id: &str) -> bool {
    matches!(engine_id, "opencode" | "claude" | "gemini" | "codex")
}

fn builtin_headless_defaults(engine_id: &str) -> Option<Vec<String>> {
    match engine_id {
        "cursor" => Some(vec![
            "agent".to_string(),
            "--print".to_string(),
            "--output-format".to_string(),
            "stream-json".to_string(),
            "--stream-partial-output".to_string(),
        ]),
        "claude" => Some(vec!["-p".to_string()]),
        "gemini" => Some(vec!["-p".to_string()]),
        "opencode" => Some(vec!["run".to_string()]),
        "codex" => Some(vec!["exec".to_string()]),
        _ => None,
    }
}


pub async fn chat_save_last_conversation_core(
    event_handle: Arc<dyn AppEventHandle>,
    payload: serde_json::Value,
) -> Result<(), CoreError> {
    let path = last_conversation_path_core().await?;
    let text = serde_json::to_string_pretty(&payload).map_err(|e| CoreError::Serialization {
        message: format!("serialize last conversation failed: {e}"),
    })?;
    tokio::fs::write(&path, text)
        .await
        .map_err(|e| CoreError::Io {
            message: format!("write last conversation failed: {e}"),
        })?;
    // Emit agent state update so frontend can sync (event-driven architecture)
    if let (Some(task_id), Some(messages)) = (
        payload.get("task_id").and_then(|v| v.as_str()),
        payload.get("messages").and_then(|v| v.as_array()),
    ) {
        let msgs: Vec<crate::agent_state::PersistedMessagePayload> = messages
            .iter()
            .filter_map(|m| {
                let id = m.get("id")?.as_str()?.to_string();
                let role = m.get("role")?.as_str().unwrap_or("user").to_string();
                let content = m.get("content")?.as_str().unwrap_or("").to_string();
                let timestamp = m.get("timestamp").and_then(|value| value.as_i64());
                let status = m
                    .get("status")
                    .and_then(|value| value.as_str())
                    .map(|value| value.to_string());
                let attachments = m
                    .get("attachments")
                    .and_then(|value| value.as_array())
                    .map(|items| {
                        items
                            .iter()
                            .filter_map(|item| {
                                Some(crate::agent_state::PersistedAttachmentPayload {
                                    name: item.get("name")?.as_str()?.to_string(),
                                    path: item.get("path")?.as_str()?.to_string(),
                                    snippet: item
                                        .get("snippet")
                                        .and_then(|value| value.as_str())
                                        .map(|value| value.to_string()),
                                })
                            })
                            .collect::<Vec<_>>()
                    })
                    .filter(|items| !items.is_empty());
                let meta = m.get("meta").cloned().filter(|value| value.is_object());
                Some(crate::agent_state::PersistedMessagePayload {
                    id,
                    role,
                    content,
                    timestamp,
                    status,
                    attachments,
                    meta,
                })
            })
            .collect();
        event_handle.emit_state_update(
            crate::agent_state::AgentStateUpdate::MessagesUpdated {
                task_id: task_id.to_string(),
                messages: msgs,
            },
        );
    }
    Ok(())
}

#[command]
pub async fn chat_save_last_conversation(
    app: AppHandle,
    payload: serde_json::Value,
    core_state: State<'_, std::sync::Arc<crate::core::MaestroCore>>,
) -> Result<(), CoreError> {
    core_state
        .inner()
        .chat_save_last_conversation(TauriEventHandle::arc(app), payload)
        .await
}

pub async fn chat_load_last_conversation_core(
    _event_handle: Arc<dyn AppEventHandle>,
) -> Result<Option<serde_json::Value>, CoreError> {
    let path = last_conversation_path_core().await?;
    if !path.exists() {
        return Ok(None);
    }
    let text = tokio::fs::read_to_string(path)
        .await
        .map_err(|e| CoreError::Io {
            message: format!("read last conversation failed: {e}"),
        })?;
    let payload =
        serde_json::from_str::<serde_json::Value>(&text).map_err(|e| CoreError::Serialization {
            message: format!("parse last conversation failed: {e}"),
        })?;
    Ok(Some(payload))
}

#[command]
pub async fn chat_load_last_conversation(
    app: AppHandle,
    core_state: State<'_, std::sync::Arc<crate::core::MaestroCore>>,
) -> Result<Option<serde_json::Value>, CoreError> {
    core_state.inner().chat_load_last_conversation(TauriEventHandle::arc(app)).await
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
pub async fn chat_execute_api_core(
    event_handle: Arc<dyn AppEventHandle>,
    core: Arc<crate::core::MaestroCore>,
    request: ChatApiRequest,
    cfg: AppConfig,
    headless_state: &HeadlessProcessState,
    on_data: Arc<dyn StringStream>,
) -> Result<ChatExecuteApiResult, CoreError> {
    let (execution_id, resolved) = {
        let prepared = crate::execution_binding::resolve_execution(
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
    let run_id_for_return = execution.id.clone();
    let exec_id = headless_state.register(execution, cancel_token.clone());
    let on_data_clone = on_data.clone();
    let root_path = std::path::PathBuf::from(&cfg.project.path);
    let io_opt = WorkspaceIo::new(&root_path).ok();
    let _ = on_data.send_string(format!("\u{0}RUN_ID:{run_id_for_return}"));

    let on_data_with_state = Arc::new(crate::core::events::StateUpdateStream {
        inner: on_data.clone(),
        event_handle: event_handle.clone(),
        task_id: task_id.clone(),
        run_id: run_id_for_return.clone(),
    });

    let exec_id_for_spawn = exec_id.clone();
    let headless_state_clone = headless_state.clone();
    let event_handle_for_emit = event_handle.clone();
    let task_id_for_emit = task_id.clone();
    let run_id_for_emit = run_id_for_return.clone();
    let core_for_spawn = core.clone();
    let event_handle_for_spawn = event_handle.clone();

    let run_id_for_spawn = run_id_for_return.clone();
    tokio::spawn(async move {
        let run_result = runtime_engine
            .run_api_chat(
                event_handle_for_spawn,
                core_for_spawn,
                ApiChatRequest {
                    provider,
                    base_url,
                    api_key: api_key.clone(),
                    model,
                    messages,
                    system_prompt: None,
                    pinned_files: request.pinned_files.unwrap_or_default(),
                    task_id: request.task_id.clone(),
                    conversation_id: request.conversation_id.clone(),
                    message_ids,
                    run_id: Some(run_id_for_spawn),
                    attachments: request.attachments,
                },
                cancel_token,
                on_data_with_state,
            )
            .await;

        if let Err(e) = match &run_result {
            Ok(_) => on_data_clone.send_string("\u{0}DONE".to_string()),
            Err(err) => on_data_clone.send_string(format!("\u{0}ERROR:{err}")),
        } {
            eprintln!("chat_execute_api: send DONE/ERROR failed: {e}");
        }
        let execution = match &run_result {
            Ok(_) => headless_state_clone.complete_and_extract(
                &exec_id_for_spawn,
                String::new(), // Orchestrator handles detailed tracking now
                None,
            ),
            Err(err) => {
                let msg = err.to_string();
                headless_state_clone.fail_and_extract(
                    &exec_id_for_spawn,
                    &msg,
                    msg.chars().take(300).collect::<String>(),
                )
            }
        };
        if let (Some(io), Ok(exec)) = (io_opt.as_ref(), execution) {
            let extra_secrets = [api_key];
            if let Err(e) = append_run_record(io, &exec, Some(&extra_secrets)) {
                eprintln!("chat_execute_api: append_run_record failed: {e}");
            }
        }
        let (status, err) = match &run_result {
            Ok(_) => ("done", None),
            Err(e) => ("error", Some(e.to_string())),
        };
        event_handle_for_emit.emit_state_update(
            crate::agent_state::run_finished_payload(
                &task_id_for_emit,
                &run_id_for_emit,
                status,
                err,
            ),
        );
    });

    Ok(ChatExecuteApiResult {
        exec_id,
        run_id: run_id_for_return,
        engine_id,
        profile_id,
    })
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

pub async fn chat_execute_cli_core(
    event_handle: Arc<dyn AppEventHandle>,
    _core: Arc<crate::core::MaestroCore>,
    request: ChatExecuteCliRequest,
    cfg: AppConfig,
    headless_state: &HeadlessProcessState,
    on_data: Arc<dyn StringStream>,
) -> Result<ChatExecuteCliResult, CoreError> {
    let (execution_id, resolved) = {
        let prepared = crate::execution_binding::resolve_execution(
            event_handle.clone(),
            &request.engine_id,
            request.profile_id.as_deref(),
            "cli",
            request.task_id.as_deref(),
            "chat_cli",
            &cfg,
        )?;
        let id = prepared
            .execution_id
            .unwrap_or_else(|| format!("chat-cli-{}-{}", request.engine_id, uuid::Uuid::new_v4()));
        (id, prepared.context)
    };
    let exec = resolved.to_execution_config();

    let fallback_headless_args = builtin_headless_defaults(&resolved.engine_id);
    let supports_headless = exec.supports_headless || fallback_headless_args.is_some();
    let i18n = cfg.i18n();
    if !supports_headless {
        event_handle.emit_state_update(
            crate::agent_state::append_system_message_payload(
                request.task_id.clone().unwrap_or_default(),
                i18n.t("cli_headless_unsupported"),
                Some(build_choice_meta(&ChoicePayload {
                    title: i18n.t("cli_headless_unsupported_title"),
                    description: Some(i18n.t("cli_headless_unsupported_desc")),
                    status: "pending".into(),
                    options: vec![
                        ChoiceOption {
                            id: "open-settings".into(),
                            label: i18n.t("open_settings"),
                            description: Some(i18n.t("check_provider_config")),
                            action: ChoiceAction::open_settings(),
                        },
                        ChoiceOption {
                            id: "switch-api".into(),
                            label: i18n.t("switch_to_api"),
                            description: Some(i18n.t("provider_api_hint")),
                            action: ChoiceAction::switch_execution_mode("api"),
                        },
                    ],
                })),
            ),
        );
        return Err(CoreError::Unsupported {
            feature: "headless mode".to_string(),
        });
    }

    let mut args = if !exec.headless_args.is_empty() {
        exec.headless_args.clone()
    } else if let Some(default_headless_args) = fallback_headless_args {
        default_headless_args
    } else {
        exec.args.clone()
    };
    args = with_model_args(
        args,
        &resolved.engine_id,
        &exec.model.clone().unwrap_or_default(),
    );
    if request.is_continuation && engine_supports_continue(&resolved.engine_id) {
        args.push("--continue".to_string());
    }
    args.push(request.prompt.clone());

    let command = exec.command.clone();
    let full_command_str = format!("{} {}", command, args.join(" "));
    let engine_id = resolved.engine_id.clone();
    let profile_id = resolved
        .profile_id
        .clone()
        .unwrap_or_else(|| "default".to_string());
    if let Err(reason) = crate::plugin_engine::action_guard::ActionGuard::unwrap_default()
        .check_command(&full_command_str)
    {
        event_handle.emit_state_update(
            crate::agent_state::append_system_message_payload(
                request.task_id.clone().unwrap_or_default(),
                i18n.t("safety_blocked"),
                Some(build_choice_meta(&ChoicePayload {
                    title: i18n.t("safety_blocked_title"),
                    description: Some(i18n.t("safety_blocked_desc")),
                    status: "pending".into(),
                    options: vec![
                        ChoiceOption {
                            id: "open-settings".into(),
                            label: i18n.t("open_settings"),
                            description: Some(i18n.t("check_provider_config")),
                            action: ChoiceAction::open_settings(),
                        },
                    ],
                })),
            ),
        );
        return Err(CoreError::PermissionDenied {
            reason: format!("Blocked by ActionGuard: {reason}"),
        });
    }
    let task_id = request.task_id.clone().unwrap_or_default();
    let cancel_token = CancellationToken::new();
    let runtime_engine = DefaultMaestroEngine;

    let now_ms = current_time_ms().unwrap_or_default();
    let execution = Execution {
        id: execution_id.clone(),
        engine_id: engine_id.to_string(),
        task_id: task_id.clone(),
        source: "chat_execute_cli".to_string(),
        mode: ExecutionMode::Cli,
        status: ExecutionStatus::Running,
        command: command.clone(),
        cwd: cfg.project.path.clone(),
        model: exec.model.clone().unwrap_or_default(),
        created_at: now_ms,
        updated_at: now_ms,
        log_path: None,
        output_preview: String::new(),
        verification: None,
        error: None,
        result: None,
        native_ref: None,
    };
    let run_id_for_return = execution.id.clone();
    let exec_id = headless_state.register(execution, cancel_token.clone());
    let on_data_clone = on_data.clone();
    let root_path = std::path::PathBuf::from(&cfg.project.path);
    let io_opt = WorkspaceIo::new(&root_path).ok();
    let _ = on_data.send_string(format!("\u{0}RUN_ID:{run_id_for_return}"));

    // Emit events for event-driven frontend sync (authored by backend)
    event_handle.emit_state_update(
        crate::agent_state::AgentStateUpdate::ExecutionStarted {
            task_id: task_id.clone(),
            run_id: run_id_for_return.clone(),
            mode: "cli".to_string(),
        },
    );

    let run_payload = crate::agent_state::task_run_from_execution(
        &run_id_for_return,
        &task_id,
        &engine_id,
        "cli",
        now_ms,
    );
    event_handle.emit_state_update(
        crate::agent_state::AgentStateUpdate::RunCreated {
            task_id: task_id.clone(),
            run: run_payload,
        },
    );

    let on_data_with_state = Arc::new(crate::core::events::StateUpdateStream {
        inner: on_data,
        event_handle: event_handle.clone(),
        task_id: task_id.clone(),
        run_id: run_id_for_return.clone(),
    });

    let exec_id_for_spawn = exec_id.clone();
    let headless_state_clone = headless_state.clone();
    let event_handle_for_emit = event_handle.clone();
    let task_id_for_emit = task_id.clone();
    let run_id_for_emit = run_id_for_return.clone();
    let i18n_for_emit = i18n.clone();
    let cwd = if cfg.project.path.trim().is_empty() {
        None
    } else {
        Some(cfg.project.path.clone())
    };
    let env = exec
        .env
        .iter()
        .map(|(k, v): (&String, &String)| (k.clone(), v.clone()))
        .collect::<Vec<_>>();

    tokio::spawn(async move {
        let run_result = runtime_engine
            .run_cli_chat(
                CliChatRequest {
                    command,
                    args,
                    cwd,
                    env,
                },
                cancel_token,
                on_data_with_state,
            )
            .await;

        match &run_result {
            Ok(out) => {
                if let Some(ref v) = out.verification {
                    if let Ok(json) = serde_json::to_string(v) {
                        let _ = on_data_clone.send_string(format!("\u{0}VERIFICATION:{json}"));
                    }
                }
                let code = out.exit_code.unwrap_or(-1);
                let _ = on_data_clone.send_string(format!("\u{0}EXIT:{code}"));
            }
            Err(err) => {
                let err_msg = err.to_string();
                if err_msg.contains("Workspace Trust Required") {
                    event_handle_for_emit.emit_state_update(
                        crate::agent_state::append_system_message_payload(
                            task_id_for_emit.clone(),
                            i18n_for_emit.t("trust_required"),
                            Some(build_choice_meta(&ChoicePayload {
                                title: i18n_for_emit.t("trust_required_title"),
                                description: Some(i18n_for_emit.t("trust_required_desc")),
                                status: "pending".into(),
                                options: vec![
                                    ChoiceOption {
                                        id: "open-trust-docs".into(),
                                        label: i18n_for_emit.t("view_fix_docs"),
                                        description: Some(
                                            i18n_for_emit.t("open_fix_docs_desc"),
                                        ),
                                        action: ChoiceAction {
                                            kind: "open_external_url".into(),
                                            mode: None,
                                            url: Some("https://docs.cursor.com/agent/trust".into()),
                                        },
                                    },
                                    ChoiceOption {
                                        id: "open-settings".into(),
                                        label: i18n_for_emit.t("open_settings"),
                                        description: Some(
                                            i18n_for_emit.t("check_engine_config_desc"),
                                        ),
                                        action: ChoiceAction::open_settings(),
                                    },
                                ],
                            })),
                        ),
                    );
                }
                let _ = on_data_clone.send_string(format!("\u{0}ERROR:{err_msg}"));
            }
        }

        let execution = match &run_result {
            Ok(out) => {
                let output_preview = out.output_snapshot.chars().take(300).collect::<String>();
                if out.exit_code.unwrap_or(-1) == 0 {
                    headless_state_clone.complete_and_extract(
                        &exec_id_for_spawn,
                        output_preview,
                        out.verification.clone(),
                    )
                } else {
                    headless_state_clone.fail_and_extract(
                        &exec_id_for_spawn,
                        format!("exit code: {}", out.exit_code.unwrap_or(-1)),
                        output_preview,
                    )
                }
            }
            Err(err) => {
                let msg = err.to_string();
                headless_state_clone.fail_and_extract(
                    &exec_id_for_spawn,
                    &msg,
                    msg.chars().take(300).collect::<String>(),
                )
            }
        };
        if let (Some(io), Ok(exec)) = (io_opt.as_ref(), execution) {
            if let Err(e) = append_run_record(io, &exec, None) {
                eprintln!("chat_execute_cli: append_run_record failed: {e}");
            }
        }
        let (status, err) = match &run_result {
            Ok(_) => ("done", None),
            Err(e) => ("error", Some(e.to_string())),
        };
        event_handle_for_emit.emit_state_update(
            crate::agent_state::run_finished_payload(
                &task_id_for_emit,
                &run_id_for_emit,
                status,
                err,
            ),
        );
    });

    Ok(ChatExecuteCliResult {
        exec_id,
        run_id: run_id_for_return,
        pid: None,
        engine_id: engine_id.to_string(),
        profile_id,
    })
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

pub fn chat_spawn_core(
    event_handle: Arc<dyn AppEventHandle>,
    request: ChatSpawnRequest,
    cfg: &crate::config::AppConfig,
    pty_state: &crate::pty::PtyManagerState,
    on_data: Channel<String>,
) -> Result<ChatSessionMeta, CoreError> {
    let prepared = crate::execution_binding::resolve_execution(
        event_handle.clone(),
        &request.engine_id,
        request.profile_id.as_deref(),
        "cli",
        request.task_id.as_deref(),
        "chat_spawn",
        cfg,
    )?;
    let resolved = prepared.context;
    let exec = resolved.to_execution_config();

    let output_buf = Arc::new(Mutex::new(String::new()));
    let output_buf_ch = Arc::clone(&output_buf);
    let bridge = Channel::new(move |chunk: InvokeResponseBody| {
        let text = match chunk {
            InvokeResponseBody::Json(s) => s,
            InvokeResponseBody::Raw(bytes) => String::from_utf8_lossy(&bytes).to_string(),
        };
        {
            let mut buf = output_buf_ch.lock().unwrap_or_else(|e| e.into_inner());
            buf.push_str(&text);
            if buf.len() > 1_000_000 {
                let drop_prefix = buf.len() - 1_000_000;
                buf.drain(..drop_prefix);
            }
        }
        let _ = on_data.send(text);
        Ok(())
    });

    let session_id = uuid::Uuid::new_v4().to_string();

    let spawn: PtySessionInfo = pty_state
        .spawn_session(
            crate::pty::PtySpawnOptions {
                session_id,
                task_id: request.task_id.clone(),
                file: exec.command.clone(),
                args: with_model_args(
                    exec.args.clone(),
                    &resolved.engine_id,
                    &exec.model.clone().unwrap_or_default(),
                ),
                cwd: if cfg.project.path.trim().is_empty() {
                    None
                } else {
                    Some(cfg.project.path.clone())
                },
                env: exec.env.clone().into_iter().collect(),
                cols: request.cols.unwrap_or(120).clamp(60, 240),
                rows: request.rows.unwrap_or(36).clamp(20, 80),
            },
            bridge,
        )
        .map_err(|e| CoreError::ExecutionFailed {
            id: "chat_spawn".to_string(),
            reason: e,
        })?;

    if let Some(ready_signal) = exec.ready_signal.as_deref() {
        if !ready_signal.trim().is_empty() {
            let deadline = Instant::now() + Duration::from_millis(10_000);
            while Instant::now() < deadline {
                let snap = output_buf.lock().unwrap_or_else(|e| e.into_inner()).clone();
                if completion_matched(Some(ready_signal), &snap) {
                    break;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
        }
    }

    Ok(ChatSessionMeta {
        session_id: spawn.session_id.clone(),
        task_id: request.task_id.clone(),
        engine_id: resolved.engine_id,
        profile_id: resolved.profile_id.unwrap_or_else(|| "default".to_string()),
        ready_signal: exec.ready_signal.clone(),
    })
}

/// Tauri 同步 command — 内部含 ready_signal 阻塞等待，
/// 同步 command 在 Tauri 的 blocking 线程池执行，不会阻塞 Tokio worker。
#[command]
pub fn chat_spawn(
    app: AppHandle,
    request: ChatSpawnRequest,
    core_state: State<'_, std::sync::Arc<crate::core::MaestroCore>>,
    on_data: Channel<String>,
) -> Result<ChatSessionMeta, CoreError> {
    core_state.inner().chat_spawn(TauriEventHandle::arc(app), request, on_data)
}

#[command]
pub fn chat_send(
    request: ChatSendRequest,
    core_state: State<'_, std::sync::Arc<crate::core::MaestroCore>>,
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
    core_state: State<'_, std::sync::Arc<crate::core::MaestroCore>>,
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
pub fn chat_resolve_pending_tool(
    core_state: State<'_, std::sync::Arc<crate::core::MaestroCore>>,
    request_id: String,
    approved: bool,
) -> Result<(), CoreError> {
    core_state.safety_manager.resolve_approval(&request_id, approved);
    Ok(())
}

