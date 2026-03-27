mod agent_state;
mod api_provider;
mod cli_state;
pub mod config;
pub(crate) mod constants;
pub mod core;
mod engine;
pub(crate) mod engines;
pub(crate) mod execution_binding;
pub(crate) mod execution_binding_repository;
mod headless;
pub mod ipc;
pub(crate) mod plugin_engine;
mod process;
mod project;
mod pty;
mod redact;
mod run_persistence;
mod scoped_fs;
pub(crate) mod snapshot_repository;
mod spec;
mod task_commands;
mod task_lifecycle;
mod task_migration;
pub(crate) mod task_repository;
pub(crate) mod task_runtime;
mod task_runtime_service;
pub(crate) mod task_state;
pub mod workflow;
pub(crate) mod workspace_commands;
mod workspace_io;

use cli_state::{
    cli_list_sessions, cli_prune_sessions, cli_read_session_logs, cli_reconcile_active_sessions,
};
use config::{load_or_create_config, save_config};
use core::MaestroCore;
use engine::{
    engine_check_command, engine_delete, engine_list, engine_list_models, engine_preflight,
    engine_set_active_profile, engine_switch_session, engine_upsert, engine_upsert_profile,
};
use process::{process_get_stats, process_start_monitor, process_stop_monitor};
use project::{
    project_detect_stack, project_git_diff, project_git_status, project_list_files,
    project_read_file, project_recommend_engine, project_set_current,
};
use pty::{pty_cleanup_dead_sessions, pty_kill, pty_kill_all, pty_resize, pty_spawn, pty_write};
use spec::{
    spec_backup, spec_detect, spec_inject, spec_list, spec_preview, spec_remove, spec_restore,
};
use task_commands::{
    task_create, task_delete, task_get_runtime_binding, task_get_runtime_context, task_get_state,
    task_list, task_refresh_runtime_snapshot, task_switch_runtime_binding, task_transition,
    task_update, task_update_runtime_binding,
};
use tauri::Manager;
use workflow::{
    chat_execute_api, chat_execute_api_stop, chat_execute_cli, chat_execute_cli_stop,
    chat_load_last_conversation, chat_save_last_conversation, chat_send, chat_spawn, chat_stop,
    chat_submit_choice, workflow_export_archives, workflow_get_archive,
    workflow_get_engine_history_detail, workflow_get_full_archive, workflow_list_archives,
    workflow_list_engine_history, workflow_run, workflow_run_step,
};
use workspace_commands::{workspace_create, workspace_delete, workspace_list, workspace_update};

mod file_watcher;
use file_watcher::{file_watcher_start, file_watcher_stop, FileWatcherState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            app.manage(FileWatcherState::new());

            let config = load_or_create_config(app.handle().clone())?;
            app.manage(MaestroCore::new(config.clone()));
            if let Ok(db_path) = crate::task_state::bmad_db_path(app.handle()) {
                if let Ok(n) =
                    crate::task_migration::migrate_backfill_task_profile_id(&db_path, &config)
                {
                    if n > 0 {
                        tracing::info!(count = n, "migration: backfilled profile_id for tasks");
                    }
                }
            }

            // Spawn background preflight for all configured engines
            let handle_clone = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                // Short delay to let frontend initialize
                tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
                if let Some(core) = handle_clone.try_state::<MaestroCore>() {
                    let config = std::sync::Arc::new(core.config.get());
                    let engine_ids: Vec<String> = config.engines.keys().cloned().collect();
                    for engine_id in engine_ids {
                        // 复用同一份快照，避免每个引擎都 clone 一次完整 AppConfig
                        if let Ok(result) = crate::engine::engine_preflight_core(
                            engine_id.clone(),
                            None,
                            (*config).clone(),
                        )
                        .await
                        {
                            crate::agent_state::emit_state_update(
                                Some(&handle_clone),
                                crate::agent_state::AgentStateUpdate::EnginePreflightComplete {
                                    engine_id,
                                    result,
                                },
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
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri app")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(core) = app_handle.try_state::<MaestroCore>() {
                    core.pty_state.kill_all();
                    core.process_monitor.stop_all();
                }
            }
        });
}
