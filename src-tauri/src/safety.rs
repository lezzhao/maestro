use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Instant, Duration};
use serde::{Serialize, Deserialize};
use tokio::sync::{oneshot, Mutex};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApprovalResponse {
    pub approved: bool,
    pub edited_arguments: Option<String>,
}

pub type ApprovalSender = oneshot::Sender<ApprovalResponse>;

pub struct QuestionResponse {
    pub selected_options: Vec<String>,
    pub custom_text: Option<String>,
    pub denied: bool,
}

pub type QuestionSender = oneshot::Sender<QuestionResponse>;

struct PendingApproval {
    sender: Option<ApprovalSender>,
    created_at: Instant,
    timeout: Duration,
}

struct PendingQuestion {
    sender: Option<QuestionSender>,
    created_at: Instant,
    timeout: Duration,
}

struct RateLimiter {
    max_requests: usize,
    window: Duration,
    timestamps: parking_lot::Mutex<Vec<Instant>>,
}

impl RateLimiter {
    fn new(window_secs: u64, max_requests: usize) -> Self {
        Self {
            window: Duration::from_secs(window_secs),
            max_requests,
            timestamps: parking_lot::Mutex::new(Vec::new()),
        }
    }
    
    fn check_and_add(&self) -> bool {
        let mut times = self.timestamps.lock();
        let now = Instant::now();
        times.retain(|&t| now.duration_since(t) < self.window);
        if times.len() >= self.max_requests {
            return false;
        }
        times.push(now);
        true
    }
}

struct SafetyState {
    approvals: HashMap<String, PendingApproval>,
    questions: HashMap<String, PendingQuestion>,
}

pub struct SafetyManager {
    state: Mutex<SafetyState>,
    rate_limiter: RateLimiter,
    active_ui_sessions: AtomicUsize,
    pub auto_deny_if_no_ui: bool,
}

impl SafetyManager {
    pub fn new() -> Self {
        Self {
            state: Mutex::new(SafetyState {
                approvals: HashMap::new(),
                questions: HashMap::new(),
            }),
            rate_limiter: RateLimiter::new(60, 120),
            active_ui_sessions: AtomicUsize::new(0),
            auto_deny_if_no_ui: true, // Default to true for diamond architecture
        }
    }

    pub fn start_reaper(self: std::sync::Arc<Self>) {
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(30));
            loop {
                interval.tick().await;
                self.cleanup_stale().await;
            }
        });
    }

    pub fn inc_ui_sessions(&self) {
        self.active_ui_sessions.fetch_add(1, Ordering::SeqCst);
    }

    pub fn dec_ui_sessions(&self) {
        self.active_ui_sessions.fetch_sub(1, Ordering::SeqCst);
    }

    pub fn get_active_ui_sessions(&self) -> usize {
        self.active_ui_sessions.load(Ordering::SeqCst)
    }

    pub async fn register_approval(&self, request_id: String, sender: ApprovalSender) -> Result<(), String> {
        if !self.rate_limiter.check_and_add() {
            return Err("Rate limit exceeded for SafetyManager".into());
        }

        // If auto_deny_if_no_ui is on and no UI is connected, deny immediately
        if self.auto_deny_if_no_ui && self.get_active_ui_sessions() == 0 {
            let _ = sender.send(ApprovalResponse { approved: false, edited_arguments: None });
            return Ok(());
        }

        let mut state = self.state.lock().await;
        self.internal_cleanup_stale(&mut state);
        
        state.approvals.insert(request_id, PendingApproval {
            sender: Some(sender),
            created_at: Instant::now(),
            timeout: Duration::from_secs(300),
        });

        Ok(())
    }

    pub async fn register_question(&self, request_id: String, sender: QuestionSender) -> Result<(), String> {
        if !self.rate_limiter.check_and_add() {
            return Err("Rate limit exceeded for SafetyManager".into());
        }

        if self.auto_deny_if_no_ui && self.get_active_ui_sessions() == 0 {
            let _ = sender.send(QuestionResponse {
                selected_options: vec![],
                custom_text: None,
                denied: true,
            });
            return Ok(());
        }

        let mut state = self.state.lock().await;
        self.internal_cleanup_stale(&mut state);
        
        state.questions.insert(request_id, PendingQuestion {
            sender: Some(sender),
            created_at: Instant::now(),
            timeout: Duration::from_secs(300),
        });

        Ok(())
    }

    pub async fn resolve_approval(&self, request_id: &str, approved: bool, edited_arguments: Option<String>) -> bool {
        let mut state = self.state.lock().await;
        if let Some(mut pending) = state.approvals.remove(request_id) {
            if let Some(sender) = pending.sender.take() {
                let _ = sender.send(ApprovalResponse { approved, edited_arguments });
                return true;
            }
        }
        false
    }

    pub async fn resolve_question(&self, request_id: &str, response: QuestionResponse) -> bool {
        let mut state = self.state.lock().await;
        if let Some(mut pending) = state.questions.remove(request_id) {
            if let Some(sender) = pending.sender.take() {
                let _ = sender.send(response);
                return true;
            }
        }
        false
    }

    pub async fn remove_approval(&self, request_id: &str) {
        let mut state = self.state.lock().await;
        state.approvals.remove(request_id);
    }
    
    pub async fn remove_question(&self, request_id: &str) {
        let mut state = self.state.lock().await;
        state.questions.remove(request_id);
    }

    pub async fn pending_count(&self) -> usize {
        let state = self.state.lock().await;
        state.approvals.len() + state.questions.len()
    }

    pub async fn clear_all(&self) {
        let mut state = self.state.lock().await;
        state.approvals.clear();
        state.questions.clear();
    }

    pub async fn cleanup_stale(&self) {
        let mut state = self.state.lock().await;
        self.internal_cleanup_stale(&mut state);
    }

    fn internal_cleanup_stale(&self, state: &mut SafetyState) {
        let now = Instant::now();

        state.approvals.retain(|id, pending| {
            if now.duration_since(pending.created_at) >= pending.timeout {
                tracing::warn!("SafetyManager: Auto-denying stale approval request {}", id);
                if let Some(tx) = pending.sender.take() {
                    let _ = tx.send(ApprovalResponse { approved: false, edited_arguments: None });
                }
                false
            } else {
                true
            }
        });

        state.questions.retain(|id, pending| {
            if now.duration_since(pending.created_at) >= pending.timeout {
                tracing::warn!("SafetyManager: Auto-denying stale question request {}", id);
                if let Some(tx) = pending.sender.take() {
                    let _ = tx.send(QuestionResponse {
                        selected_options: vec![],
                        custom_text: None,
                        denied: true,
                    });
                }
                false
            } else {
                true
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_safety_manager_timeout() {
        tokio::time::pause();
        let manager = SafetyManager::new();
        let (tx, rx) = tokio::sync::oneshot::channel();
        
        manager.register_approval("test_req".to_string(), tx).await.unwrap();
        
        tokio::time::advance(Duration::from_secs(360)).await;
        
        manager.cleanup_stale().await;
        
        let res = rx.await.unwrap();
        assert_eq!(res.approved, false);
    }

    #[tokio::test]
    async fn test_safety_manager_auto_deny_no_ui() {
        let mut manager = SafetyManager::new();
        manager.auto_deny_if_no_ui = true;
        // active_ui_sessions is 0 by default
        
        let (tx, rx) = tokio::sync::oneshot::channel();
        manager.register_approval("test_req".to_string(), tx).await.unwrap();
        
        let res = rx.await.unwrap();
        assert_eq!(res.approved, false); // Denied immediately
    }

    #[tokio::test]
    async fn test_safety_manager_allow_with_ui() {
        let mut manager = SafetyManager::new();
        manager.auto_deny_if_no_ui = true;
        manager.inc_ui_sessions();
        
        let (tx, mut _rx) = tokio::sync::oneshot::channel();
        manager.register_approval("test_req".to_string(), tx).await.unwrap();
        
        assert_eq!(manager.pending_count().await, 1);
    }

    #[tokio::test]
    async fn test_safety_manager_concurrency() {
        use std::sync::Arc;
        let manager = Arc::new(SafetyManager::new());
        manager.inc_ui_sessions(); // Ensure it doesn't auto-deny
        let mut handles = vec![];
        
        for i in 0..100 {
            let m = manager.clone();
            handles.push(tokio::spawn(async move {
                let (tx, _rx) = tokio::sync::oneshot::channel::<ApprovalResponse>();
                m.register_approval(format!("req_{}", i), tx).await.is_ok()
            }));
        }
        
        let mut success_count = 0;
        for h in handles {
            if h.await.unwrap() {
                success_count += 1;
            }
        }
        
        assert_eq!(success_count, 100);
        assert_eq!(manager.pending_count().await, 100);
        
        manager.clear_all().await;
        assert_eq!(manager.pending_count().await, 0);
    }
}
