//! MaestroCore: application facade. Does not absorb domain rules.
//!
//! Service boundaries (logical; implemented via delegation):
//! - Task: task_create, task_transition, task_delete, task_list, task_switch_runtime_binding, task_update_runtime_binding
//! - Execution: list_executions, cancel_execution, fetch_logs, reconcile, export_archive
//! - Engine: engine_list, engine_upsert, engine_set_active_profile, engine_upsert_profile, engine_preflight
//! - Workflow: workflow_run, workflow_run_step, chat_execute_api, chat_execute_cli, chat_spawn
//! - WorkspaceIo: workspace_io (delegates to crate::workspace_io)

pub mod error;
pub mod events;
pub mod execution;

// Application Services (Facade Splitting)
pub mod engine_app_service;
pub mod execution_app_service;
pub mod pty_app_service;
pub mod spec_app_service;
pub mod task_app_service;
pub mod workflow_app_service;

#[cfg(test)]
mod tests;

use crate::config::{AppConfig, AppConfigState};
use crate::headless::HeadlessProcessState;
use crate::process::ProcessMonitorState;
use crate::pty::PtyManagerState;
use std::collections::HashSet;
use std::sync::Mutex;

pub struct MaestroCore {
    pub config: AppConfigState,
    pub pty_state: PtyManagerState,
    pub process_monitor: ProcessMonitorState,
    pub headless_state: HeadlessProcessState,
    pub(crate) deleted_task_ids: Mutex<HashSet<String>>,
}

impl MaestroCore {
    pub fn new(config: AppConfig) -> Self {
        Self {
            config: AppConfigState::new(config),
            pty_state: PtyManagerState::default(),
            process_monitor: ProcessMonitorState::default(),
            headless_state: HeadlessProcessState::default(),
            deleted_task_ids: Mutex::new(HashSet::new()),
        }
    }

    /// Use-Case: Get WorkspaceIo instance for current project
    pub fn workspace_io(&self) -> Result<crate::workspace_io::WorkspaceIo, String> {
        let path = self.config.get().project.path.clone();
        let project = if path.trim().is_empty() {
            std::env::current_dir().map_err(|e| format!("resolve current dir failed: {e}"))?
        } else {
            std::path::PathBuf::from(path)
        };
        crate::workspace_io::WorkspaceIo::new(&project)
    }
}
