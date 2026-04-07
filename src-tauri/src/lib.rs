pub mod agent_state;
mod api_provider;
mod cli_state;
pub mod config;
pub(crate) mod constants;
pub mod core;
mod engine;
mod headless;
pub mod i18n;
pub mod infra;
pub mod ipc;
pub(crate) mod plugin_engine;
mod process;
mod pty;
mod redact;
pub mod storage;
pub mod task;
mod tools;
mod mcp;
mod spec;
mod safety;
pub mod workflow;
use std::sync::Arc;
use cli_state::{
    cli_list_sessions, cli_prune_sessions, cli_read_session_logs, cli_reconcile_active_sessions,
};
use config::{
    get_builtin_roles, load_or_create_config, save_config, update_max_concurrent_tasks,
    verify::verify_llm_connection,
};
use crate::infra::project::{
    project_detect_stack, project_find_symbols, project_git_diff, project_git_status,
    project_list_files, project_list_files_deep, project_read_file, project_recommend_engine,
    project_set_current,
};
use storage::conversation::{
    conversation_create, conversation_delete, conversation_generate_title, conversation_list,
    conversation_load_messages, conversation_update_title,
};
use core::MaestroCore;
use engine::{
    engine_check_command, engine_delete, engine_list, engine_list_models, engine_preflight,
    engine_set_active_profile, engine_switch_session, engine_upsert, engine_upsert_profile,
};
use process::{process_get_stats, process_start_monitor, process_stop_monitor};


use pty::{pty_cleanup_dead_sessions, pty_kill, pty_kill_all, pty_resize, pty_spawn, pty_write};
use spec::{
    spec_backup, spec_detect, spec_inject, spec_list, spec_preview, spec_remove, spec_restore,
};
use crate::task::commands::{
    task_create, task_delete, task_get_runtime_binding, task_get_runtime_context, task_get_state,
    task_list, task_refresh_runtime_snapshot, task_switch_runtime_binding, task_transition,
    task_update, task_update_runtime_binding,
};
use tauri::Manager;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use workflow::{
    chat_execute_api, chat_execute_api_stop, chat_execute_cli, chat_execute_cli_stop,
    chat_load_last_conversation, chat_save_last_conversation, chat_send, chat_spawn, chat_stop,
    chat_submit_choice, workflow_export_archives, workflow_get_archive,
    workflow_get_engine_history_detail, workflow_get_full_archive, workflow_list_archives,
    workflow_list_engine_history, workflow_run, workflow_run_step, chat_resolve_pending_tool, chat_resolve_pending_question,
    ui_session_init, ui_session_destroy,
};
use crate::infra::workspace_commands::{workspace_create, workspace_delete, workspace_list, workspace_update};


use infra::file_watcher::{file_watcher_start, file_watcher_stop, FileWatcherState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        // Default shortcut is Option+Space
                        let meta = shortcut.id().to_string();
                        if meta.contains("Alt") && meta.contains("Space") {
                            if let Some(window) = app.get_webview_window("main") {
                                let is_visible = window.is_visible().unwrap_or(false);
                                let is_focused = window.is_focused().unwrap_or(false);

                                if is_visible && is_focused {
                                    let _ = window.hide();
                                } else {
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                }
                            }
                        }
                    }
                })
                .build(),
        )
        .setup(|app| {
            let shortcut = Shortcut::new(
                Some(tauri_plugin_global_shortcut::Modifiers::ALT),
                tauri_plugin_global_shortcut::Code::Space,
            );
            let _ = app.global_shortcut().register(shortcut);

            app.manage(FileWatcherState::new());

            let config = load_or_create_config(app.handle().clone())?;
            let core = Arc::new(MaestroCore::new(config.clone()));
            core.safety_manager.clone().start_reaper();
            app.manage(core);
            if let Ok(db_path) = crate::task::state::maestro_db_path(app.handle()) {
                let manager = crate::task::migrations::MigrationManager::new(&db_path, &config);
                if let Ok(n) = manager.migrate_all() {
                    if n > 0 {
                        tracing::info!(count = n, "migration: processed incremental updates");
                    }
                }
            }

            // Spawn background preflight for all configured engines
            let handle_clone = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                // Short delay to let frontend initialize
                tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
                if let Some(core) = handle_clone.try_state::<Arc<MaestroCore>>() {
                    let config_snapshot = (*core.config.get()).clone();
                    let engine_ids: Vec<String> = config_snapshot.engines.keys().cloned().collect();
                    for engine_id in engine_ids {
                        // 复用同一份快照，避免每个引擎都 clone 一次完整 AppConfig
                        if let Ok(result) = crate::engine::engine_preflight_core(
                            engine_id.clone(),
                            None,
                            config_snapshot.clone(),
                        )
                        .await
                        {
                            crate::agent_state::emit_state_update(
                                Some(&handle_clone),
                                crate::agent_state::AgentStateUpdate::EnginePreflightComplete {
                                    engine_id,
                                    result,
                                },
                                None,
                            );
                        }
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_or_create_config,
            save_config,
            verify_llm_connection,
            engine_check_command,
            engine_delete,
            engine_list,
            engine_list_models,
            engine_upsert,
            engine_preflight,
            engine_switch_session,
            engine_set_active_profile,
            engine_upsert_profile,
            pty_spawn,
            pty_write,
            pty_resize,
            pty_kill,
            pty_kill_all,
            spec_list,
            spec_inject,
            spec_remove,
            spec_detect,
            spec_preview,
            spec_backup,
            spec_restore,
            project_detect_stack,
            project_set_current,
            project_recommend_engine,
            project_git_status,
            project_git_diff,
            project_list_files,
            project_list_files_deep,
            project_find_symbols,
            project_read_file,
            process_get_stats,
            process_start_monitor,
            process_stop_monitor,
            workflow_run,
            workflow_list_archives,
            workflow_get_archive,
            workflow_get_full_archive,
            workflow_list_engine_history,
            workflow_get_engine_history_detail,
            workflow_export_archives,
            workflow_run_step,
            chat_spawn,
            chat_send,
            chat_stop,
            chat_execute_api,
            chat_execute_api_stop,
            chat_execute_cli,
            chat_execute_cli_stop,
            chat_save_last_conversation,
            chat_load_last_conversation,
            chat_submit_choice,
            chat_resolve_pending_tool,
            chat_resolve_pending_question,
            cli_list_sessions,
            cli_read_session_logs,
            cli_prune_sessions,
            cli_reconcile_active_sessions,
            pty_cleanup_dead_sessions,
            task_create,
            task_delete,
            task_list,
            task_update,
            task_transition,
            task_get_state,
            task_get_runtime_context,
            task_get_runtime_binding,
            task_refresh_runtime_snapshot,
            task_switch_runtime_binding,
            task_update_runtime_binding,
            workspace_create,
            workspace_list,
            workspace_update,
            workspace_delete,
            file_watcher_start,
            file_watcher_stop,
            get_builtin_roles,
            update_max_concurrent_tasks,
            conversation_create,
            conversation_delete,
            conversation_list,
            conversation_load_messages,
            conversation_update_title,
            conversation_generate_title,
            ui_session_init,
            ui_session_destroy,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri app")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(core) = app_handle.try_state::<Arc<MaestroCore>>() {
                    core.pty_state.kill_all();
                    core.process_monitor.stop_all();
                }
            }
        });
}
