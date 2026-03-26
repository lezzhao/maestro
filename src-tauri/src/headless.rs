use crate::core::execution::Execution;
use crate::workflow::types::VerificationSummary;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio_util::sync::CancellationToken;

pub struct HeadlessEntry {
    pub execution: Execution,
    pub cancel_token: CancellationToken,
}

/// Manages headless execution lifecycle: register → running → complete/fail/cancel → extract for persist.
#[derive(Default, Clone)]
pub struct HeadlessProcessState {
    entries: Arc<Mutex<HashMap<String, HeadlessEntry>>>,
}

impl HeadlessProcessState {
    /// Register a new execution and return its id.
    pub fn register(&self, execution: Execution, cancel_token: CancellationToken) -> String {
        let exec_id = execution.id.clone();
        self.entries
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(
                exec_id.clone(),
                HeadlessEntry {
                    execution,
                    cancel_token,
                },
            );
        exec_id
    }

    /// Cancel an active execution. Sends cancel signal; the task will call fail_and_extract
    /// to remove and persist. Do NOT remove here to avoid race with the task.
    pub fn cancel(&self, exec_id: &str) -> Result<(), String> {
        let mut map = self.entries.lock().unwrap_or_else(|e| e.into_inner());
        let entry = map
            .get_mut(exec_id)
            .ok_or_else(|| format!("exec not found: {exec_id}"))?;
        entry.cancel_token.cancel();
        Ok(())
    }

    /// Get execution by id if still active.
    pub fn get_execution(&self, exec_id: &str) -> Option<Execution> {
        self.entries
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(exec_id)
            .map(|entry| entry.execution.clone())
    }

    /// Update execution in place (for advanced use; prefer complete_and_extract / fail_and_extract).
    pub fn update_execution<F>(&self, exec_id: &str, f: F) -> Result<Execution, String>
    where
        F: FnOnce(&mut Execution),
    {
        let mut map = self.entries.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(entry) = map.get_mut(exec_id) {
            f(&mut entry.execution);
            Ok(entry.execution.clone())
        } else {
            Err(format!("exec not found: {exec_id}"))
        }
    }

    /// Remove execution from active map (low-level; prefer complete_and_extract / fail_and_extract).
    pub fn remove(&self, exec_id: &str) -> Option<Execution> {
        self.entries
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(exec_id)
            .map(|entry| entry.execution)
    }

    /// List all active (in-memory) executions.
    pub fn list_active(&self) -> Vec<Execution> {
        self.entries
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .values()
            .map(|entry| entry.execution.clone())
            .collect()
    }

    /// Mark execution as completed, remove from active map, and return it for persistence.
    /// Caller should call append_run_record(root, &exec) after this.
    pub fn complete_and_extract(
        &self,
        exec_id: &str,
        output_preview: impl Into<String>,
        verification: Option<VerificationSummary>,
    ) -> Result<Execution, String> {
        let mut map = self.entries.lock().unwrap_or_else(|e| e.into_inner());
        let mut entry = map
            .remove(exec_id)
            .ok_or_else(|| format!("exec not found: {exec_id}"))?;
        entry.execution.complete_with(output_preview, verification);
        Ok(entry.execution)
    }

    /// Mark execution as failed, remove from active map, and return it for persistence.
    /// Caller should call append_run_record(root, &exec) after this.
    pub fn fail_and_extract(
        &self,
        exec_id: &str,
        reason: impl Into<String>,
        output_preview: impl Into<String>,
    ) -> Result<Execution, String> {
        let mut map = self.entries.lock().unwrap_or_else(|e| e.into_inner());
        let mut entry = map
            .remove(exec_id)
            .ok_or_else(|| format!("exec not found: {exec_id}"))?;
        entry.execution.fail_with(reason, output_preview);
        Ok(entry.execution)
    }
}
