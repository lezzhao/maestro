use super::error;
use super::MaestroCore;
use crate::agent_state::emitter::AppEventHandle;
use crate::agent_state::{AgentStateUpdate, TaskRecordPayload};
use crate::infra::workspace_commands::{list_workspaces, create_workspace, WorkspaceCreateRequest};

impl MaestroCore {
    /// Ensure a default workspace and task exist if the database is empty.
    pub fn ensure_default_state(&self) -> Result<(), error::CoreError> {
        let db_path = &self.state_db_path;
        let conn = crate::task::repository::db_connection(db_path)?;
        crate::task::repository::ensure_tables(&conn)?;
        crate::infra::workspace_commands::ensure_workspace_schema(&conn)?;
        drop(conn);

        let tasks = self.task_list()?;
        let workspaces = list_workspaces(db_path)?;

        if !tasks.is_empty() && !workspaces.is_empty() {
            tracing::debug!("App state already initialized (tasks: {}, workspaces: {}).", tasks.len(), workspaces.len());
            return Ok(());
        }

        tracing::info!("Initializing cold-start state: tasks={} workspaces={}", tasks.len(), workspaces.len());

        // 1. Ensure a workspace exists
        let workspace_id = if let Some(ws) = workspaces.first() {
            tracing::info!("Using existing workspace: {}", ws.id);
            ws.id.clone()
        } else {
            tracing::info!("No workspaces found. Creating 'Personal Space'...");
            let req = WorkspaceCreateRequest {
                name: "Personal Space".to_string(),
                working_directory: None,
                icon: Some("Layout".to_string()),
                color: Some("#6366f1".to_string()),
                preferred_engine_id: Some(crate::constants::DEFAULT_ENGINE_ID.to_string()),
                preferred_profile_id: None,
                spec_provider: None,
                spec_mode: None,
                spec_target_ide: None,
                settings: None,
            };
            let ws = create_workspace(&self.state_db_path, &req)?;
            tracing::info!("Created default workspace: {}", ws.id);
            
            // Emit workspace creation so UI can sync immediately
            self.event_registry.emit_state_update(AgentStateUpdate::WorkspaceCreated {
                workspace: ws.clone(),
            });
            
            ws.id
        };

        // 2. Ensure at least one task exists
        if tasks.is_empty() {
            tracing::info!("No tasks found. Creating default 'Getting Started' task...");
            let config = self.config.get();
            let engine_id = crate::constants::DEFAULT_ENGINE_ID.to_string();
            let profile_id = config.engines.get(&engine_id)
                .map(|e| e.active_profile_id.clone())
                .unwrap_or_else(|| "default".to_string());

            let result = self.task_create(crate::task::state::TaskCreateRequest {
                title: "Welcome to Maestro 🚀".to_string(),
                description: "Welcome! Start a chat below, or press Ctrl+Shift+Space (or click ✨) to wake up Jiavis, your voice & vision assistant.".to_string(),
                engine_id,
                workspace_boundary: "".to_string(),
                profile_id: Some(profile_id),
                workspace_id: Some(workspace_id),
                settings: None,
            });
            
            match result {
                Ok(r) => tracing::info!("Successfully created 'Getting Started' task: {}", r.id),
                Err(e) => tracing::error!("Failed to seed default task: {}", e),
            }
        }

        Ok(())
    }

    /// Use-Case: Create task and broadcast state event.
    /// Requires explicit profile_id in request (no migration fallback).
    pub fn task_create(
        &self,
        request: crate::task::state::TaskCreateRequest,
    ) -> Result<crate::task::state::TaskCreateResult, error::CoreError> {
        let config = self.config.get();
        let db_path = &self.state_db_path;
        let workspace_boundary = if request.workspace_boundary.is_empty() {
            let project_path = config.project.path.clone();
            if project_path.is_empty() {
                "{}".to_string()
            } else {
                serde_json::json!({ "root": project_path }).to_string()
            }
        } else {
            request.workspace_boundary.clone()
        };

        let profile_id = request
            .profile_id
            .ok_or_else(|| error::CoreError::ValidationError {
                field: "profile_id".to_string(),
                message: "profile_id is required for task_create".to_string(),
            })?;

        let created = crate::task::state::create_task(
            db_path,
            &request.title,
            &request.description,
            &request.engine_id,
            &workspace_boundary,
            Some(profile_id.as_str()),
            request.workspace_id.as_deref(),
            request.settings.as_deref(),
        )?;
        let id = created.id.clone();
        let current_state = crate::task::state::TaskState::Backlog.as_str().to_string();
        let result = crate::task::state::TaskCreateResult {
            id: id.clone(),
            title: request.title.clone(),
            description: request.description.clone(),
            engine_id: request.engine_id.clone(),
            current_state: current_state.clone(),
            workspace_boundary: workspace_boundary.clone(),
            profile_id: Some(profile_id.clone()),
            workspace_id: request.workspace_id.clone(),
            settings: request.settings.clone(),
        };

        self.event_registry.emit_state_update(
            AgentStateUpdate::TaskCreated {
                task: TaskRecordPayload {
                    id,
                    title: request.title,
                    description: request.description,
                    engine_id: request.engine_id,
                    current_state,
                    workspace_boundary,
                    profile_id: Some(profile_id),
                    workspace_id: request.workspace_id,
                    settings: request.settings,
                    runtime_snapshot_id: None,
                    created_at: created.created_at_ms,
                    updated_at: created.updated_at_ms,
                },
            },
        );
        Ok(result)
    }

    /// Use-Case: Transition task state and broadcast state event.
    pub fn task_transition(
        &self,
        request: crate::task::state::TaskTransitionRequest,
    ) -> Result<String, error::CoreError> {
        let event =
            crate::task::state::TaskEvent::from_str(&request.event_type, request.event_reason)
                .ok_or_else(|| error::CoreError::ValidationError {
                    field: "event_type".to_string(),
                    message: format!("invalid event: {}", request.event_type),
                })?;
        let db_path = &self.state_db_path;
        let io = self.workspace_io()?;
        let to_state = crate::task::state::transition(
            db_path,
            &io,
            &request.task_id,
            &request.from_state,
            &event,
            request.take_snapshot,
        )?;
        self.event_registry.emit_state_update(
            AgentStateUpdate::TaskStateChanged {
                task_id: request.task_id,
                from_state: request.from_state,
                to_state: to_state.clone(),
            },
        );
        Ok(to_state)
    }

    /// Use-Case: Delete task and broadcast state event.
    pub fn task_delete(&self, task_id: String) -> Result<(), error::CoreError> {
        let db_path = &self.state_db_path;
        crate::task::state::delete_task(db_path, &task_id)?;
        self.deleted_task_ids
            .lock()
            .unwrap_or_else(|e| {
                tracing::warn!("deleted_task_ids lock was poisoned, recovering");
                e.into_inner()
            })
            .insert(task_id.clone());
        if let Ok(io) = self.workspace_io() {
            let _ = crate::storage::run_persistence::remove_records_by_task_id(&io, &task_id);
        }
        let _ = self.pty_state.kill_sessions_by_task(&task_id);
        self.event_registry.emit_state_update(
            AgentStateUpdate::TaskDeleted {
                task_id: task_id.clone(),
            },
        );
        Ok(())
    }

    pub fn task_list(&self) -> Result<Vec<TaskRecordPayload>, error::CoreError> {
        let db_path = &self.state_db_path;
        crate::task::state::list_tasks(db_path)
    }

    pub fn get_task_state(
        &self,
        request: crate::task::state::TaskGetStateRequest,
    ) -> Result<Option<String>, error::CoreError> {
        let db_path = &self.state_db_path;
        crate::task::state::get_task_state(db_path, &request.task_id)
    }

    pub fn task_update(
        &self,
        request: crate::task::state::TaskUpdateRequest,
    ) -> Result<(), error::CoreError> {
        let db_path = &self.state_db_path;
        crate::task::state::update_task(db_path, &request)?;

        // 重新拉取最新任务快照，并发出明确的更新事件
        if let Some(task) = crate::task::repository::get_task_record(db_path, &request.id)? {
            self.event_registry.emit_state_update(AgentStateUpdate::TaskUpdated { task });
        }
        Ok(())
    }

    /// Use-Case: Switch task's engine atomically.
    /// Delegates to task_switch_transaction which enforces: DB update -> event broadcast -> session cleanup.
    pub fn task_switch_runtime_binding(
        &self,
        request: crate::task::state::TaskSwitchRuntimeBindingRequest,
    ) -> Result<(), error::CoreError> {
        let config = self.config.get();
        super::task_switch_transaction::execute(&self.state_db_path, self.event_registry.clone(), request, &config, &self.pty_state)
    }

    /// Use-Case: Update task's engine and broadcast state event.
    /// Prefer task_switch_engine when session cleanup is needed (e.g. user-initiated switch).
    pub fn task_update_runtime_binding(
        &self,
        request: crate::task::state::TaskUpdateRuntimeBindingRequest,
    ) -> Result<(), error::CoreError> {
        let config = self.config.get();
        let result = crate::task::runtime_service::update_task_runtime_context(
            &self.state_db_path,
            &request.task_id,
            &request.engine_id,
            request.profile_id,
            &config,
        )
        .map_err(error::CoreError::from)?;
        self.event_registry.emit_state_update(
            AgentStateUpdate::TaskRuntimeBindingChanged {
                task_id: request.task_id.clone(),
                binding: result.binding,
            },
        );
        if let Some(ctx) = result.resolved_context {
            self.event_registry.emit_state_update(
                AgentStateUpdate::TaskRuntimeContextResolved {
                    task_id: request.task_id,
                    context: ctx,
                },
            );
        }
        Ok(())
    }

    pub fn get_active_assistant_msg_id(&self, task_id: Option<&str>) -> Option<String> {
        let tid = task_id?;
        crate::task::repository::get_latest_assistant_message_id(&self.state_db_path, tid).ok().flatten()
    }
}
