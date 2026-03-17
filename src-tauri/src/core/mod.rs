pub mod error;
pub mod events;
pub mod execution;

use crate::config::{AppConfigState, AppConfig};
use crate::core::events::EventStream;
use crate::config::{EngineConfig, EngineProfile};
use crate::engine::{EngineModelListResult, EnginePreflightResult};
use crate::headless::HeadlessProcessState;
use crate::process::ProcessMonitorState;
use crate::pty::{PtyManagerState, PtySessionInfo};
use crate::spec::{SpecDescriptor, SpecDetectResult, SpecPreviewResult};
use crate::workflow::types::{ChatApiRequest, ChatExecuteCliRequest, StepRunRequest, WorkflowRunRequest};
use crate::workflow::chat::{chat_execute_api_core, chat_execute_cli_core};
use crate::workflow::run::{workflow_run_core, workflow_run_step_core};
use crate::agent_state::{emit_state_update, AgentStateUpdate, TaskRecordPayload};
use crate::core::events::StringStream;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::Mutex;
use std::sync::Arc;
use tauri::ipc::Channel;
use tauri::AppHandle;

pub struct MaestroCore {
    pub config: AppConfigState,
    pub pty_state: PtyManagerState,
    pub process_monitor: ProcessMonitorState,
    pub headless_state: HeadlessProcessState,
    deleted_task_ids: Mutex<HashSet<String>>,
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


    /// Workflow run - creates Execution at start, persists at end
    pub async fn workflow_run(
        &self,
        emitter: Arc<dyn EventStream>,
        request: WorkflowRunRequest,
    ) -> Result<crate::workflow::types::WorkflowRunResult, String> {
        workflow_run_core(
            emitter,
            request,
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

    /// Use-Case: Chat spawn - creates a raw pseudo-terminal session for CLI chat
    pub fn chat_spawn(
        &self,
        request: crate::workflow::types::ChatSpawnRequest,
        on_data: Channel<String>,
    ) -> Result<crate::workflow::types::ChatSessionMeta, error::CoreError> {
        crate::workflow::chat::chat_spawn_core(request, &self.config.get(), &self.pty_state, on_data)
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
        let io = self.workspace_io().map_err(|e| error::CoreError::Io {
            message: format!("workspace_io failed: {e}"),
        })?;
        let records = crate::run_persistence::read_run_records(&io).unwrap_or_default();
        Ok(records)
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
            // Logs are typically in global ~/.bmad/sessions, not scoped to workspace,
            // so we keep using std::fs::read_to_string here.
            let text = std::fs::read_to_string(path).map_err(|e| error::CoreError::Io {
                message: format!("read execution log failed: {e}"),
            })?;
            return Ok(text);
        }
        Ok(record.output_preview)
    }

    /// Use-Case: Reconcile active executions against running OS processes
    pub fn reconcile(&self) -> Result<(), error::CoreError> {
        let io = self.workspace_io().map_err(|reason| error::CoreError::ValidationError {
            field: "project.path".to_string(),
            message: reason,
        })?;
        let mut records = crate::run_persistence::read_run_records(&io).map_err(|e| {
            error::CoreError::Io {
                message: format!("read run records failed: {e}"),
            }
        })?;
        let mut changed = false;
        for item in &mut records {
            if item.status != crate::core::execution::ExecutionStatus::Running {
                continue;
            }
            if !item.task_id.trim().is_empty()
                && self
                    .deleted_task_ids
                    .lock()
                    .expect("deleted_task_ids lock poisoned")
                    .contains(&item.task_id)
            {
                item.status = crate::core::execution::ExecutionStatus::Failed;
                item.error = Some("reconciled as orphaned task execution".to_string());
                changed = true;
                continue;
            }
            let headless_active = self.headless_state.get_execution(&item.id).is_some();
            let pty_active = self.pty_state.active_os_pid(&item.id).is_some();
            if !headless_active && !pty_active {
                item.status = crate::core::execution::ExecutionStatus::Failed;
                if item.error.is_none() {
                    item.error = Some("reconciled as not running".to_string());
                }
                changed = true;
            }
        }
        if changed {
            crate::run_persistence::rewrite_run_records(&io, &records).map_err(|e| {
                error::CoreError::Io {
                    message: format!("rewrite run records failed: {e}"),
                }
            })?;
        }
        Ok(())
    }

    /// Use-Case: Save last conversation state
    pub async fn chat_save_last_conversation(
        &self,
        app: AppHandle,
        payload: serde_json::Value,
    ) -> Result<(), error::CoreError> {
        crate::workflow::chat::chat_save_last_conversation_core(app, payload).await
    }

    /// Use-Case: Load last conversation state
    pub async fn chat_load_last_conversation(
        &self,
        app: AppHandle,
    ) -> Result<Option<serde_json::Value>, error::CoreError> {
        crate::workflow::chat::chat_load_last_conversation_core(app).await
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
            &request.engine_id,
            &workspace_boundary,
        )?;
        let current_state = crate::task_state::TaskState::Backlog.as_str().to_string();
        let result = crate::task_state::TaskCreateResult {
            id: id.clone(),
            title: request.title.clone(),
            description: request.description.clone(),
            engine_id: request.engine_id.clone(),
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
                    engine_id: request.engine_id,
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
        let io = self.workspace_io()?;
        let to_state = crate::task_state::transition(
            &db_path,
            &io,
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
        self.deleted_task_ids
            .lock()
            .expect("deleted_task_ids lock poisoned")
            .insert(task_id.clone());
        let _ = self.workspace_io().and_then(|io| crate::run_persistence::remove_records_by_task_id(&io, &task_id));
        let _ = self.pty_state.kill_sessions_by_task(&task_id);
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

    /// Use-Case: Update task's engine and broadcast state event.
    pub fn task_update_engine(
        &self,
        app: &AppHandle,
        request: crate::task_state::TaskUpdateEngineRequest,
    ) -> Result<(), String> {
        let config = self.config.get();
        if !config.engines.contains_key(&request.engine_id) {
            return Err(format!("engine not found: {}", request.engine_id));
        }
        let db_path = crate::task_state::bmad_db_path(app)?;
        crate::task_state::update_task_engine(&db_path, &request.task_id, &request.engine_id)?;
        emit_state_update(
            Some(app),
            AgentStateUpdate::TaskEngineChanged {
                task_id: request.task_id,
                engine_id: request.engine_id,
            },
        );
        Ok(())
    }

    pub fn spec_list(&self) -> Vec<SpecDescriptor> {
        crate::spec::spec_descriptors(&self.config.get())
    }

    pub fn spec_inject(
        &self,
        provider: String,
        project_path: String,
        mode: String,
        target_ide: String,
    ) -> Result<(), String> {
        crate::spec::spec_inject_core(
            &self.config.get(),
            provider,
            project_path,
            mode,
            target_ide,
        )
    }

    pub fn spec_remove(&self, provider: String, project_path: String) -> Result<(), String> {
        crate::spec::spec_remove_core(&self.config.get(), provider, project_path)
    }

    pub fn spec_detect(&self, project_path: String) -> Vec<SpecDetectResult> {
        crate::spec::spec_detect_core(&self.config.get(), project_path)
    }

    pub fn spec_preview(
        &self,
        provider: String,
        mode: String,
        target_ide: String,
    ) -> Result<Vec<SpecPreviewResult>, String> {
        crate::spec::spec_preview_core(&self.config.get(), provider, mode, target_ide)
    }

    pub fn spec_backup(&self, project_path: String) -> Result<Vec<String>, String> {
        crate::spec::spec_backup_core(&self.config.get(), project_path)
    }

    pub fn spec_restore(&self, project_path: String) -> Result<Vec<String>, String> {
        crate::spec::spec_restore_core(&self.config.get(), project_path)
    }

    pub fn engine_list(&self) -> BTreeMap<String, EngineConfig> {
        crate::engine::engine_list_core(&self.config)
    }

    pub fn engine_upsert(&self, app: &AppHandle, id: String, engine: EngineConfig) -> Result<(), String> {
        crate::engine::engine_upsert_core(app, id, engine, &self.config)
    }

    pub fn engine_set_active_profile(
        &self,
        app: &AppHandle,
        engine_id: String,
        profile_id: String,
    ) -> Result<(), String> {
        crate::engine::engine_set_active_profile_core(app, engine_id, profile_id, &self.config)
    }

    pub fn engine_upsert_profile(
        &self,
        app: &AppHandle,
        engine_id: String,
        profile_id: String,
        profile: EngineProfile,
    ) -> Result<(), String> {
        crate::engine::engine_upsert_profile_core(app, engine_id, profile_id, profile, &self.config)
    }

    pub fn engine_set_active(&self, engine_id: String) -> Result<(), String> {
        crate::engine::engine_set_active_core(engine_id, &self.config)
    }

    pub fn engine_get_active(&self) -> Result<Option<String>, String> {
        Ok(None) // deprecated, frontend uses active task's engineId
    }

    pub async fn engine_preflight(&self, engine_id: String) -> Result<EnginePreflightResult, String> {
        crate::engine::engine_preflight_core(engine_id, self.config.get()).await
    }

    pub async fn engine_list_models(&self, engine_id: String) -> Result<EngineModelListResult, String> {
        crate::engine::engine_list_models_core(engine_id, self.config.get()).await
    }

    pub fn engine_switch_session(
        &self,
        engine_id: String,
        session_id: Option<String>,
    ) -> Result<crate::engine::EngineSwitchResult, String> {
        crate::engine::engine_switch_session_core(
            engine_id,
            session_id,
            self.config.get(),
            &self.pty_state,
        )
    }

    pub fn pty_spawn(
        &self,
        session_id: String,
        task_id: Option<String>,
        file: String,
        args: Vec<String>,
        cwd: Option<String>,
        env: HashMap<String, String>,
        cols: u16,
        rows: u16,
        on_data: Channel<String>,
    ) -> Result<PtySessionInfo, String> {
        self.pty_state
            .spawn_session(session_id, task_id, file, args, cwd, env, cols, rows, on_data)
    }

    pub fn pty_write(&self, session_id: String, data: String) -> Result<(), String> {
        self.pty_state.write_to_session(&session_id, &data)
    }

    pub fn pty_resize(&self, session_id: String, cols: u16, rows: u16) -> Result<(), String> {
        self.pty_state.resize_session(&session_id, cols, rows)
    }

    pub fn pty_kill(&self, session_id: String) -> Result<(), String> {
        self.pty_state.kill_session(&session_id)
    }

    pub fn pty_kill_all(&self) {
        self.pty_state.kill_all();
    }

    pub fn pty_cleanup_dead_sessions(&self) -> usize {
        self.pty_state.cleanup_dead_sessions()
    }
}
