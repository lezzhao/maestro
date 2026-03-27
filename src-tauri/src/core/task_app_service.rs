use super::error;
use super::MaestroCore;
use crate::agent_state::{emit_state_update, AgentStateUpdate, TaskRecordPayload};
use crate::task_runtime_service;
use tauri::AppHandle;

impl MaestroCore {
    /// Use-Case: Create task and broadcast state event.
    /// Requires explicit profile_id in request (no migration fallback).
    pub fn task_create(
        &self,
        app: &AppHandle,
        request: crate::task_state::TaskCreateRequest,
    ) -> Result<crate::task_state::TaskCreateResult, error::CoreError> {
        let config = self.config.get();
        let db_path = crate::task_state::bmad_db_path(app)?;
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

        let created = crate::task_state::create_task(
            &db_path,
            &request.title,
            &request.description,
            &request.engine_id,
            &workspace_boundary,
            Some(profile_id.as_str()),
            request.workspace_id.as_deref(),
            request.settings.as_deref(),
        )?;
        let id = created.id.clone();
        let current_state = crate::task_state::TaskState::Backlog.as_str().to_string();
        let result = crate::task_state::TaskCreateResult {
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
        app: &AppHandle,
        request: crate::task_state::TaskTransitionRequest,
    ) -> Result<String, error::CoreError> {
        let event =
            crate::task_state::TaskEvent::from_str(&request.event_type, request.event_reason)
                .ok_or_else(|| error::CoreError::ValidationError {
                    field: "event_type".to_string(),
                    message: format!("invalid event: {}", request.event_type),
                })?;
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
    pub fn task_delete(&self, app: &AppHandle, task_id: String) -> Result<(), error::CoreError> {
        let db_path = crate::task_state::bmad_db_path(app)?;
        crate::task_state::delete_task(&db_path, &task_id)?;
        self.deleted_task_ids
            .lock()
            .unwrap_or_else(|e| {
                tracing::warn!("deleted_task_ids lock was poisoned, recovering");
                e.into_inner()
            })
            .insert(task_id.clone());
        if let Ok(io) = self.workspace_io() {
            let _ = crate::run_persistence::remove_records_by_task_id(&io, &task_id);
        }
        let _ = self.pty_state.kill_sessions_by_task(&task_id);
        emit_state_update(
            Some(app),
            AgentStateUpdate::TaskDeleted {
                task_id: task_id.clone(),
            },
        );
        Ok(())
    }

    pub fn task_list(&self, app: &AppHandle) -> Result<Vec<TaskRecordPayload>, error::CoreError> {
        let db_path = crate::task_state::bmad_db_path(app)?;
        crate::task_state::list_tasks(&db_path)
    }

    pub fn get_task_state(
        &self,
        app: &AppHandle,
        request: crate::task_state::TaskGetStateRequest,
    ) -> Result<Option<String>, error::CoreError> {
        let db_path = crate::task_state::bmad_db_path(app)?;
        crate::task_state::get_task_state(&db_path, &request.task_id)
    }

    pub fn task_update(
        &self,
        app: &AppHandle,
        request: crate::task_state::TaskUpdateRequest,
    ) -> Result<(), error::CoreError> {
        let db_path = crate::task_state::bmad_db_path(app)?;
        crate::task_state::update_task(&db_path, &request)?;

        // 重新拉取最新任务快照，并发出明确的更新事件
        if let Some(task) = crate::task_repository::get_task_record(&db_path, &request.id)? {
            emit_state_update(Some(app), AgentStateUpdate::TaskUpdated { task });
        }
        Ok(())
    }

    /// Use-Case: Switch task's engine atomically.
    /// Delegates to task_switch_transaction which enforces: DB update -> event broadcast -> session cleanup.
    pub fn task_switch_runtime_binding(
        &self,
        app: &AppHandle,
        request: crate::task_state::TaskSwitchRuntimeBindingRequest,
    ) -> Result<(), error::CoreError> {
        let config = self.config.get();
        super::task_switch_transaction::execute(app, request, &config, &self.pty_state)
    }

    /// Use-Case: Update task's engine and broadcast state event.
    /// Prefer task_switch_engine when session cleanup is needed (e.g. user-initiated switch).
    pub fn task_update_runtime_binding(
        &self,
        app: &AppHandle,
        request: crate::task_state::TaskUpdateRuntimeBindingRequest,
    ) -> Result<(), error::CoreError> {
        let config = self.config.get();
        let result = task_runtime_service::update_task_runtime_context(
            app,
            &request.task_id,
            &request.engine_id,
            request.profile_id,
            &config,
        )
        .map_err(error::CoreError::from)?;
        emit_state_update(
            Some(app),
            AgentStateUpdate::TaskRuntimeBindingChanged {
                task_id: request.task_id.clone(),
                binding: result.binding,
            },
        );
        if let Some(ctx) = result.resolved_context {
            emit_state_update(
                Some(app),
                AgentStateUpdate::TaskRuntimeContextResolved {
                    task_id: request.task_id,
                    context: ctx,
                },
            );
        }
        Ok(())
    }
}
