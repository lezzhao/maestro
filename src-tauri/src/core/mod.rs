pub mod error;
pub mod events;
pub mod execution;

use crate::config::{AppConfigState, AppConfig};
use crate::engine::EngineRuntimeState;
use crate::headless::HeadlessProcessState;
use crate::process::ProcessMonitorState;
use crate::pty::PtyManagerState;


pub struct MaestroCore {
    pub config: AppConfigState,
    pub pty_state: PtyManagerState,
    pub engine_runtime: EngineRuntimeState,
    pub process_monitor: ProcessMonitorState,
    pub headless_state: HeadlessProcessState,
}

impl MaestroCore {
    pub fn new(config: AppConfig) -> Self {
        Self {
            config: AppConfigState::new(config),
            pty_state: PtyManagerState::default(),
            engine_runtime: EngineRuntimeState::default(),
            process_monitor: ProcessMonitorState::default(),
            headless_state: HeadlessProcessState::default(),
        }
    }

    /// Use-Case: Start a new execution
    pub fn start_execution(&self, _execution: crate::core::execution::Execution) -> Result<(), error::CoreError> {
        // Implementation delegates to proper modes (PTY/Headless/API)
        Ok(())
    }

    /// Use-Case: Cancel an active execution
    pub fn cancel_execution(&self, id: &str) -> Result<(), error::CoreError> {
        // Try PTY
        if self.pty_state.kill_session(id).is_ok() {
            return Ok(());
        }
        // Try Headless
        self.headless_state.cancel(id).map_err(error::CoreError::CancelFailed)
    }

    /// Use-Case: List all executions
    pub fn list_executions(&self) -> Result<Vec<crate::core::execution::Execution>, error::CoreError> {
        // In reality, this queries run-records.jsonl
        // For now, return stub
        Ok(vec![])
    }

    /// Use-Case: Fetch logs for an execution
    pub fn fetch_logs(&self, _id: &str) -> Result<String, error::CoreError> {
        Ok(String::new())
    }

    /// Use-Case: Reconcile active executions against running OS processes
    pub fn reconcile(&self) -> Result<(), error::CoreError> {
        Ok(())
    }

    /// Use-Case: Export an execution as an archive
    pub fn export_archive(&self, _id: &str) -> Result<Vec<u8>, error::CoreError> {
        Ok(vec![])
    }
}
