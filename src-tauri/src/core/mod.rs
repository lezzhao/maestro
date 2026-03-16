pub mod error;
pub mod events;
pub mod execution;

use crate::config::{AppConfigState, AppConfig};
use crate::core::events::EventStream;
use crate::engine::EngineRuntimeState;
use crate::headless::HeadlessProcessState;
use crate::process::ProcessMonitorState;
use crate::pty::PtyManagerState;
use crate::workflow::types::{ChatApiRequest, ChatExecuteCliRequest, StepRunRequest, WorkflowRunRequest};
use crate::workflow::chat::{chat_execute_api_core, chat_execute_cli_core};
use crate::workflow::run::{workflow_run_core, workflow_run_step_core};
use crate::core::events::StringStream;
use std::sync::Arc;

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


    /// Workflow run - creates Execution at start, persists at end
    pub async fn workflow_run(
        &self,
        emitter: Arc<dyn EventStream>,
        request: WorkflowRunRequest,
    ) -> Result<crate::workflow::types::WorkflowRunResult, String> {
        workflow_run_core(
            emitter,
            request,
            &self.engine_runtime,
            &self.config.get(),
            &self.pty_state,
        )
        .await
    }

    /// Workflow run single step
    pub async fn workflow_run_step(
        &self,
        emitter: Arc<dyn EventStream>,
        request: StepRunRequest,
    ) -> Result<crate::workflow::types::StepRunResult, String> {
        workflow_run_step_core(
            emitter,
            request,
            &self.engine_runtime,
            &self.config.get(),
            &self.pty_state,
        )
        .await
    }

    /// Chat execute via API - creates Execution, registers with headless, spawns
    pub async fn chat_execute_api(
        &self,
        request: ChatApiRequest,
        on_data: Arc<dyn StringStream>,
    ) -> Result<crate::workflow::types::ChatExecuteApiResult, error::CoreError> {
        chat_execute_api_core(request, self.config.get(), &self.headless_state, on_data).await
    }

    /// Chat execute via CLI - creates Execution, registers with headless, spawns
    pub async fn chat_execute_cli(
        &self,
        request: ChatExecuteCliRequest,
        on_data: Arc<dyn StringStream>,
    ) -> Result<crate::workflow::types::ChatExecuteCliResult, error::CoreError> {
        chat_execute_cli_core(request, self.config.get(), &self.headless_state, on_data).await
    }

    /// Use-Case: Cancel an active execution
    pub fn cancel_execution(&self, id: &str) -> Result<(), error::CoreError> {
        if self.pty_state.kill_session(id).is_ok() {
            return Ok(());
        }
        self.headless_state.cancel(id).map_err(|e| error::CoreError::CancelFailed { id: id.to_string(), reason: e })
    }

    /// Use-Case: List all executions
    pub fn list_executions(&self) -> Result<Vec<crate::core::execution::Execution>, error::CoreError> {
        let root_dir = crate::run_persistence::resolve_root_dir_from_project_path(&self.config.get().project.path).unwrap_or_else(|_| {
            let mut pb = std::path::PathBuf::from(&self.config.get().project.path);
            pb.push(".maestro-cli");
            pb
        });
        
        let records = crate::run_persistence::read_run_records(&root_dir).unwrap_or_default();
        Ok(records)
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
