use super::MaestroCore;
use tauri::AppHandle;
use crate::agent_state::{emit_state_update, AgentStateUpdate, TaskRecordPayload};
use crate::task_runtime_service;

impl MaestroCore {
    /// Use-Case: Create task and broadcast state event.
    /// Requires explicit profile_id in request (no migration fallback).
    pub fn task_create(
        &self,
        app: &AppHandle,
        request: crate::task_state::TaskCreateRequest,
    ) -> Result<crate::task_state::TaskCreateResult, String> {
        let config = self.config.get();
        let db_path = crate::task_state::bmad_db_path(app).map_err(|e| e.to_string())?;
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

        let profile_id = request.profile_id.ok_or_else(|| {
            "profile_id is required for task_create".to_string()
        })?;

        let created = crate::task_state::create_task(
            &db_path,
            &request.title,
            &request.description,
            &request.engine_id,
            &workspace_boundary,
            profile_id.as_deref(),
        )
        .map_err(|e| e.to_string())?;
        let id = created.id.clone();
        let current_state = crate::task_state::TaskState::Backlog.as_str().to_string();
        let result = crate::task_state::TaskCreateResult {
            id: id.clone(),
            title: request.title.clone(),
            description: request.description.clone(),
            engine_id: request.engine_id.clone(),
            current_state: current_state.clone(),
            workspace_boundary: workspace_boundary.clone(),
            profile_id: profile_id.clone(),
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
                    profile_id: profile_id,
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
    ) -> Result<String, String> {
        let event = crate::task_state::TaskEvent::from_str(&request.event_type, request.event_reason)
            .ok_or_else(|| format!("invalid event: {}", request.event_type))?;
        let db_path = crate::task_state::bmad_db_path(app).map_err(|e| e.to_string())?;
        let io = self.workspace_io()?;
        let to_state = crate::task_state::transition(
            &db_path,
            &io,
            &request.task_id,
            &request.from_state,
            &event,
            request.take_snapshot,
        )
        .map_err(|e| e.to_string())?;
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
        let db_path = crate::task_state::bmad_db_path(app).map_err(|e| e.to_string())?;
        crate::task_state::delete_task(&db_path, &task_id).map_err(|e| e.to_string())?;
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
        let db_path = crate::task_state::bmad_db_path(app).map_err(|e| e.to_string())?;
        crate::task_state::list_tasks(&db_path).map_err(|e| e.to_string())
    }

    pub fn task_get_state(
        &self,
        app: &AppHandle,
        request: crate::task_state::TaskGetStateRequest,
    ) -> Result<Option<String>, String> {
        let db_path = crate::task_state::bmad_db_path(app).map_err(|e| e.to_string())?;
        crate::task_state::get_task_state(&db_path, &request.task_id).map_err(|e| e.to_string())
    }

    /// Use-Case: Switch task's engine atomically.
    /// Performs: DB update -> event broadcast -> session cleanup (if session_id provided).
    /// Order ensures: if DB fails, session is untouched and user can retry; if cleanup fails after DB success, binding is already updated and orphan session can be recovered later.
    pub fn task_switch_runtime_binding(
        &self,
        app: &AppHandle,
        request: crate::task_state::TaskSwitchRuntimeBindingRequest,
    ) -> Result<(), String> {
        let config = self.config.get();
        let result = task_runtime_service::update_task_runtime_context(
            app,
            &request.task_id,
            &request.engine_id,
            request.profile_id,
            &config,
        )?;
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
        if let Some(ref session_id) = request.session_id {
            let _ = crate::engine::cleanup_session_for_task_engine_switch(
                request.engine_id.clone(),
                Some(session_id.clone()),
                config.clone(),
                &self.pty_state,
            );
        }
        Ok(())
    }

    /// Use-Case: Update task's engine and broadcast state event.
    /// Prefer task_switch_engine when session cleanup is needed (e.g. user-initiated switch).
    pub fn task_update_runtime_binding(
        &self,
        app: &AppHandle,
        request: crate::task_state::TaskUpdateRuntimeBindingRequest,
    ) -> Result<(), String> {
        let config = self.config.get();
        let result = task_runtime_service::update_task_runtime_context(
            app,
            &request.task_id,
            &request.engine_id,
            request.profile_id,
            &config,
        )?;
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
