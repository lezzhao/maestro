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
use crate::agent_state::{emit_state_update, AgentStateUpdate, TaskRecordPayload};
use crate::core::events::StringStream;
use std::sync::Arc;
use tauri::AppHandle;

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
        app: Option<AppHandle>,
        request: ChatApiRequest,
        on_data: Arc<dyn StringStream>,
    ) -> Result<crate::workflow::types::ChatExecuteApiResult, error::CoreError> {
        chat_execute_api_core(app, request, self.config.get(), &self.headless_state, on_data).await
    }

    /// Chat execute via CLI - creates Execution, registers with headless, spawns
    pub async fn chat_execute_cli(
        &self,
        app: Option<AppHandle>,
        request: ChatExecuteCliRequest,
        on_data: Arc<dyn StringStream>,
    ) -> Result<crate::workflow::types::ChatExecuteCliResult, error::CoreError> {
        chat_execute_cli_core(app, request, self.config.get(), &self.headless_state, on_data).await
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
    pub fn fetch_logs(&self, id: &str) -> Result<String, error::CoreError> {
        let records = self.list_executions()?;
        let record = records
            .into_iter()
            .find(|item| item.id == id)
            .ok_or_else(|| error::CoreError::NotFound {
                resource: "execution".to_string(),
                id: id.to_string(),
            })?;
        if let Some(path) = record.log_path {
            let text = std::fs::read_to_string(path).map_err(|e| error::CoreError::Io {
                message: format!("read execution log failed: {e}"),
            })?;
            return Ok(text);
        }
        Ok(record.output_preview)
    }

    /// Use-Case: Reconcile active executions against running OS processes
    pub fn reconcile(&self) -> Result<(), error::CoreError> {
        let root_dir = crate::run_persistence::resolve_root_dir_from_project_path(&self.config.get().project.path)
            .map_err(|reason| error::CoreError::ValidationError {
                field: "project.path".to_string(),
                message: reason,
            })?;
        let mut records = crate::run_persistence::read_run_records(&root_dir).map_err(|e| {
            error::CoreError::Io {
                message: format!("read run records failed: {e}"),
            }
        })?;
        let mut changed = false;
        for item in &mut records {
            if item.status != crate::core::execution::ExecutionStatus::Running {
                continue;
            }
            let headless_active = self.headless_state.get_execution(&item.id).is_some();
            let pty_active = self.pty_state.active_os_pid(Some(item.id.clone())).is_some();
            if !headless_active && !pty_active {
                item.status = crate::core::execution::ExecutionStatus::Failed;
                if item.error.is_none() {
                    item.error = Some("reconciled as not running".to_string());
                }
                changed = true;
            }
        }
        if changed {
            crate::run_persistence::rewrite_run_records(&root_dir, &records).map_err(|e| {
                error::CoreError::Io {
                    message: format!("rewrite run records failed: {e}"),
                }
            })?;
        }
        Ok(())
    }

    /// Use-Case: Export an execution as an archive
    pub fn export_archive(&self, id: &str) -> Result<Vec<u8>, error::CoreError> {
        Ok(self.fetch_logs(id)?.into_bytes())
    }

    /// Use-Case: Create task and broadcast state event.
    pub fn task_create(
        &self,
        app: &AppHandle,
        request: crate::task_state::TaskCreateRequest,
    ) -> Result<crate::task_state::TaskCreateResult, String> {
        let db_path = crate::task_state::bmad_db_path(app)?;
        let workspace_boundary = if request.workspace_boundary.is_empty() {
            let project_path = self.config.get().project.path.clone();
            if project_path.is_empty() {
                "{}".to_string()
            } else {
                serde_json::json!({ "root": project_path }).to_string()
            }
        } else {
            request.workspace_boundary.clone()
        };

        let id = crate::task_state::create_task(
            &db_path,
            &request.title,
            &request.description,
            &workspace_boundary,
        )?;
        let current_state = crate::task_state::TaskState::Backlog.as_str().to_string();
        let result = crate::task_state::TaskCreateResult {
            id: id.clone(),
            title: request.title.clone(),
            description: request.description.clone(),
            current_state: current_state.clone(),
            workspace_boundary: workspace_boundary.clone(),
        };

        emit_state_update(
            Some(app),
            AgentStateUpdate::TaskCreated {
                task: TaskRecordPayload {
                    id,
                    title: request.title,
                    description: request.description,
                    current_state,
                    workspace_boundary,
                    created_at: String::new(),
                    updated_at: String::new(),
                },
            },
        );
        Ok(result)
    }

    /// Use-Case: Transition task state and broadcast state event.
    pub fn task_transition(
        &self,
        app: &AppHandle,
        request: crate::task_state::TaskTransitionRequest,
    ) -> Result<String, String> {
        let event = crate::task_state::TaskEvent::from_str(&request.event_type, request.event_reason)
            .ok_or_else(|| format!("invalid event: {}", request.event_type))?;
        let db_path = crate::task_state::bmad_db_path(app)?;
        let project_path = std::path::PathBuf::from(self.config.get().project.path.as_str());
        let to_state = crate::task_state::transition(
            &db_path,
            &project_path,
            &request.task_id,
            &request.from_state,
            &event,
            request.take_snapshot,
        )?;
        emit_state_update(
            Some(app),
            AgentStateUpdate::TaskStateChanged {
                task_id: request.task_id,
                from_state: request.from_state,
                to_state: to_state.clone(),
            },
        );
        Ok(to_state)
    }

    /// Use-Case: Delete task and broadcast state event.
    pub fn task_delete(&self, app: &AppHandle, task_id: String) -> Result<(), String> {
        let db_path = crate::task_state::bmad_db_path(app)?;
        crate::task_state::delete_task(&db_path, &task_id)?;
        emit_state_update(
            Some(app),
            AgentStateUpdate::TaskDeleted {
                task_id: task_id.clone(),
            },
        );
        Ok(())
    }

    pub fn task_list(&self, app: &AppHandle) -> Result<Vec<TaskRecordPayload>, String> {
        let db_path = crate::task_state::bmad_db_path(app)?;
        crate::task_state::list_tasks(&db_path)
    }

    pub fn task_get_state(
        &self,
        app: &AppHandle,
        request: crate::task_state::TaskGetStateRequest,
    ) -> Result<Option<String>, String> {
        let db_path = crate::task_state::bmad_db_path(app)?;
        crate::task_state::get_task_state(&db_path, &request.task_id)
    }
}
