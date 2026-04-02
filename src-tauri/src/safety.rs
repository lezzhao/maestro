use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Instant, Duration};
use crate::core::ApprovalSender;

struct PendingApproval {
    sender: ApprovalSender,
    created_at: Instant,
}

pub struct SafetyManager {
    pending_approvals: Mutex<HashMap<String, PendingApproval>>,
}

impl SafetyManager {
    pub fn new() -> Self {
        Self {
            pending_approvals: Mutex::new(HashMap::new()),
        }
    }

    pub fn register_approval(&self, request_id: String, sender: ApprovalSender) {
        let mut approvals = self.pending_approvals.lock().unwrap();
        // Self-cleanup on every registration to keep it tidy
        let now = Instant::now();
        approvals.retain(|_, v| now.duration_since(v.created_at) < Duration::from_secs(600)); // 10 mins
        
        approvals.insert(request_id, PendingApproval {
            sender,
            created_at: now,
        });
    }

    pub fn resolve_approval(&self, request_id: &str, approved: bool) -> bool {
        let mut approvals = self.pending_approvals.lock().unwrap();
        if let Some(pending) = approvals.remove(request_id) {
            let _ = pending.sender.send(approved);
            true
        } else {
            false
        }
    }

    pub fn remove_approval(&self, request_id: &str) {
        let mut approvals = self.pending_approvals.lock().unwrap();
        approvals.remove(request_id);
    }

    /// Explicitly remove old approvals that were never resolved.
    pub fn cleanup_stale(&self) {
        let mut approvals = self.pending_approvals.lock().unwrap();
        let now = Instant::now();
        approvals.retain(|_, v| now.duration_since(v.created_at) < Duration::from_secs(600));
    }
}
