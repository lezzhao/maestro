mod api_provider;
mod cli_state;
pub mod config;
pub mod core;
mod engine;
pub mod engines;
mod headless;
pub mod ipc;
pub mod plugin_engine;
mod process;
mod project;
mod pty;
mod run_persistence;
mod spec;
pub mod workflow;

use cli_state::{cli_list_sessions, cli_prune_sessions, cli_read_session_logs};
use config::{load_or_create_config, save_config, AppConfigState};
use engine::{
    engine_get_active, engine_list, engine_list_models, engine_preflight, engine_set_active,
    engine_set_active_profile, engine_switch_session, engine_upsert, engine_upsert_profile,
    EngineRuntimeState,
};
use headless::HeadlessProcessState;
use process::{
    process_get_stats, process_start_monitor, process_stop_monitor, ProcessMonitorState,
};
use project::{
    project_detect_stack, project_git_diff, project_git_status, project_list_files,
    project_read_file, project_recommend_engine, project_set_current,
};
use pty::{
    pty_active_session, pty_kill, pty_kill_all, pty_resize, pty_spawn, pty_write, PtyManagerState,
};
use spec::{spec_detect, spec_inject, spec_list, spec_remove};
use tauri::Manager;
use workflow::{
    chat_execute_api, chat_execute_api_stop, chat_execute_cli, chat_execute_cli_stop,
    chat_load_last_conversation, chat_save_last_conversation, chat_send, chat_spawn, chat_stop,
    workflow_export_archives, workflow_get_archive, workflow_get_engine_history_detail,
    workflow_get_full_archive, workflow_list_archives, workflow_list_engine_history, workflow_run,
    workflow_run_step,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let config = load_or_create_config(app.handle().clone())?;
            app.manage(AppConfigState::new(config));
            app.manage(PtyManagerState::default());
            app.manage(EngineRuntimeState::default());
            app.manage(ProcessMonitorState::default());
            app.manage(HeadlessProcessState::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_or_create_config,
            save_config,
            engine_list,
            engine_list_models,
            engine_upsert,
            engine_set_active,
            engine_get_active,
            engine_preflight,
            engine_switch_session,
            engine_set_active_profile,
            engine_upsert_profile,
            pty_spawn,
            pty_write,
            pty_resize,
            pty_kill,
            pty_kill_all,
            pty_active_session,
            spec_list,
            spec_inject,
            spec_remove,
            spec_detect,
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
            cli_list_sessions,
            cli_read_session_logs,
            cli_prune_sessions,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri app")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(pty) = app_handle.try_state::<PtyManagerState>() {
                    pty.kill_all();
                }
                if let Some(monitor) = app_handle.try_state::<ProcessMonitorState>() {
                    monitor.stop_all();
                }
            }
        });
}
