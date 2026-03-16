use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::sync::oneshot;

#[derive(Default)]
pub struct HeadlessProcessState {
    entries: Arc<Mutex<HashMap<String, oneshot::Sender<()>>>>,
}

impl HeadlessProcessState {
    pub fn register(&self, exec_id: String, cancel_tx: oneshot::Sender<()>) -> String {
        self.entries
            .lock()
            .expect("headless process lock poisoned")
            .insert(exec_id.clone(), cancel_tx);
        exec_id
    }

    pub fn cancel(&self, exec_id: &str) -> Result<(), String> {
        let tx = self
            .entries
            .lock()
            .expect("headless process lock poisoned")
            .remove(exec_id)
            .ok_or_else(|| format!("exec not found: {exec_id}"))?;
        tx.send(()).map_err(|_| "exec already finished".to_string())
    }

    pub fn clone_entries(&self) -> Arc<Mutex<HashMap<String, oneshot::Sender<()>>>> {
        Arc::clone(&self.entries)
    }
}
