use crate::core::execution::{Execution, ExecutionStatus};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::sync::oneshot;

pub struct HeadlessEntry {
    pub execution: Execution,
    pub cancel_tx: oneshot::Sender<()>,
}

#[derive(Default, Clone)]
pub struct HeadlessProcessState {
    entries: Arc<Mutex<HashMap<String, HeadlessEntry>>>,
}

impl HeadlessProcessState {
    pub fn register(&self, execution: Execution, cancel_tx: oneshot::Sender<()>) -> String {
        let exec_id = execution.id.clone();
        self.entries
            .lock()
            .expect("headless process lock poisoned")
            .insert(
                exec_id.clone(),
                HeadlessEntry {
                    execution,
                    cancel_tx,
                },
            );
        exec_id
    }

    pub fn cancel(&self, exec_id: &str) -> Result<(), String> {
        let mut map = self.entries.lock().expect("headless process lock poisoned");
        let entry = map
            .remove(exec_id)
            .ok_or_else(|| format!("exec not found: {exec_id}"))?;
        
        let _ = entry.cancel_tx.send(());
        Ok(())
    }

    pub fn get_execution(&self, exec_id: &str) -> Option<Execution> {
        self.entries
            .lock()
            .expect("headless process lock poisoned")
            .get(exec_id)
            .map(|entry| entry.execution.clone())
    }

    pub fn update_execution<F>(&self, exec_id: &str, f: F) -> Result<Execution, String>
    where
        F: FnOnce(&mut Execution),
    {
        let mut map = self.entries.lock().expect("headless process lock poisoned");
        if let Some(entry) = map.get_mut(exec_id) {
            f(&mut entry.execution);
            Ok(entry.execution.clone())
        } else {
            Err(format!("exec not found: {exec_id}"))
        }
    }

    pub fn remove(&self, exec_id: &str) -> Option<Execution> {
        self.entries
            .lock()
            .expect("headless process lock poisoned")
            .remove(exec_id)
            .map(|entry| entry.execution)
    }

    pub fn list_active(&self) -> Vec<Execution> {
        self.entries
            .lock()
            .expect("headless process lock poisoned")
            .values()
            .map(|entry| entry.execution.clone())
            .collect()
    }
}
