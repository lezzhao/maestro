use super::MaestroCore;
use super::error;

/// Explicit target for cancel. Avoids ambiguous id (session vs execution).
#[derive(Debug, Clone)]
pub enum CancelTarget {
    /// PTY session id (chat_spawn, interactive terminal)
    SessionId(String),
    /// Headless execution id (chat_execute_api, chat_execute_cli)
    ExecutionId(String),
}

impl MaestroCore {
    /// Use-Case: Cancel an active execution. Caller must specify target type.
    pub fn cancel_execution(&self, target: CancelTarget) -> Result<(), error::CoreError> {
        match target {
            CancelTarget::SessionId(id) => self.pty_state.kill_session(&id).map_err(|e| {
                error::CoreError::CancelFailed {
                    id: id.clone(),
                    reason: e,
                }
            }),
            CancelTarget::ExecutionId(id) => self
                .headless_state
                .cancel(&id)
                .map_err(|e| error::CoreError::CancelFailed {
                    id: id.clone(),
                    reason: e,
                }),
        }
    }

    /// Use-Case: List all executions
    pub fn list_executions(&self) -> Result<Vec<crate::core::execution::Execution>, error::CoreError> {
        let io = self.workspace_io().map_err(|e| error::CoreError::Io {
            message: format!("workspace_io failed: {e}"),
        })?;
        let records = crate::run_persistence::read_run_records(&io).unwrap_or_default();
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

    /// Use-Case: Export an execution as an archive
    pub fn export_archive(&self, id: &str) -> Result<Vec<u8>, error::CoreError> {
        Ok(self.fetch_logs(id)?.into_bytes())
    }
}
