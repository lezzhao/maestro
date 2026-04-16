use crate::agent_state::{AppEventHandle, append_system_message_payload, build_choice_meta, ChoicePayload, ChoiceOption, ChoiceAction};
use crate::config::AppConfig;
use crate::core::error::CoreError;
use crate::core::events::StringStream;
use crate::core::execution::{Execution, ExecutionMode, ExecutionStatus};
use crate::headless::HeadlessProcessState;
use crate::plugin_engine::maestro_engine::{CliChatRequest, DefaultMaestroEngine, MaestroEngine};
use crate::storage::run_persistence::current_time_ms;
use crate::infra::workspace_io::WorkspaceIo;
use super::super::types::{ChatExecuteCliRequest, ChatExecuteCliResult};
use super::super::execution_lifecycle::ExecutionLifecycle;
use super::utils::{builtin_headless_defaults, engine_supports_continue};
use super::super::util::with_model_args;
use std::sync::Arc;
use tokio_util::sync::CancellationToken;

pub async fn chat_execute_cli_core(
    event_handle: Arc<dyn AppEventHandle>,
    _core: Arc<crate::core::MaestroCore>,
    request: ChatExecuteCliRequest,
    cfg: AppConfig,
    headless_state: &HeadlessProcessState,
    on_data: Arc<dyn StringStream>,
    _permit: Option<crate::task::queue::TaskPermit>,
) -> Result<ChatExecuteCliResult, CoreError> {
    let (execution_id, resolved) = {
        let prepared = crate::storage::execution_binding::resolve_execution(
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
    let cycle_id = uuid::Uuid::new_v4().to_string();
    let exec = resolved.to_execution_config();

    let fallback_headless_args = builtin_headless_defaults(&resolved.engine_id);
    let supports_headless = exec.supports_headless || fallback_headless_args.is_some();
    let i18n = cfg.i18n();
    if !supports_headless {
        event_handle.emit_state_update(
            append_system_message_payload(
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
            append_system_message_payload(
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
        None,
        request.state_token.clone(),
    );

    let i18n_for_emit = i18n.clone();
    let event_handle_for_emit = event_handle.clone();
    let task_id_for_emit = task_id.clone();
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

    let res_cycle_id = cycle_id.clone();
    let res_exec_id = execution_id.clone();

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
                    lifecycle.send_verification(v.clone());
                }
                let code = out.exit_code.unwrap_or(-1);
                lifecycle.send_exit(code);
            }
            Err(err) => {
                let err_msg = err.to_string();
                if err_msg.contains("Workspace Trust Required") {
                    event_handle_for_emit.emit_state_update(
                        append_system_message_payload(
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
            }
        }

        let (output_preview, verification) = match &run_result {
            Ok(out) => (
                out.output_snapshot.chars().take(300).collect::<String>(),
                out.verification.clone(),
            ),
            Err(_) => (String::new(), None),
        };

        lifecycle.finish(run_result, output_preview, verification);
    });

    Ok(ChatExecuteCliResult {
        exec_id: res_exec_id.clone(),
        run_id: res_exec_id,
        cycle_id: res_cycle_id,
        pid: None,
        engine_id: engine_id.to_string(),
        profile_id,
    })
}
