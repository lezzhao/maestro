//! MaestroCore: application facade. Does not absorb domain rules.
//!
//! Service boundaries (logical; implemented via delegation):
//! - task_app_service: task_create, task_transition, task_delete, task_list, task_switch_runtime_binding, task_update_runtime_binding
//! - execution_app_service: list_executions, cancel_execution, fetch_logs, reconcile, export_archive
//! - engine_app_service: engine_list, engine_upsert, engine_set_active_profile, engine_upsert_profile, engine_preflight
//! - workflow_app_service: workflow_run, workflow_run_step, chat_execute_api, chat_execute_cli, chat_spawn
//! - WorkspaceIo: workspace_io (delegates to crate::workspace_io)
//!
//! Dependency direction (one-way; no cycles):
//!   workflow_app_service → execution_binding (resolve_execution)
//!   execution_app_service → task_runtime, execution_binding
//!   task_app_service → task_state, task_runtime_service
//!   engine_app_service → config, engine
//!
//! Rules for code review:
//! - workflow_app_service: does NOT do runtime fallback; uses resolve_execution only
//! - execution_app_service: does NOT change task lifecycle core rules
//! - task_app_service: does NOT directly own low-level IO
//! - workspace_io: infrastructure only; no business policy

pub mod error;
pub mod events;
pub mod execution;
pub mod task_switch_transaction;

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
    pub fn workspace_io(&self) -> Result<crate::workspace_io::WorkspaceIo, error::CoreError> {
        let path = self.config.get().project.path.clone();
        let project = if path.trim().is_empty() {
            std::env::current_dir().map_err(|e| error::CoreError::Io {
                message: format!("resolve current dir failed: {e}"),
            })?
        } else {
            std::path::PathBuf::from(path)
        };
        crate::workspace_io::WorkspaceIo::new(&project).map_err(error::CoreError::from)
    }
}
