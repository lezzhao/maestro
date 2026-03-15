use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::oneshot;

#[derive(Default)]
pub struct HeadlessProcessState {
    next_id: AtomicU32,
    entries: Arc<Mutex<HashMap<u32, oneshot::Sender<()>>>>,
}

impl HeadlessProcessState {
    pub fn register(&self, cancel_tx: oneshot::Sender<()>) -> u32 {
        let exec_id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        self.entries
            .lock()
            .expect("headless process lock poisoned")
            .insert(exec_id, cancel_tx);
        exec_id
    }

    pub fn cancel(&self, exec_id: u32) -> Result<(), String> {
        let tx = self
            .entries
            .lock()
            .expect("headless process lock poisoned")
            .remove(&exec_id)
            .ok_or_else(|| format!("exec not found: {exec_id}"))?;
        tx.send(()).map_err(|_| "exec already finished".to_string())
    }

    pub fn clone_entries(&self) -> Arc<Mutex<HashMap<u32, oneshot::Sender<()>>>> {
        Arc::clone(&self.entries)
    }
}
