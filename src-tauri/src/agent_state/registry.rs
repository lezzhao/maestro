use std::sync::Arc;
use parking_lot::RwLock;
use super::{AgentStateUpdate, AppEventHandle};

/// A registry that manages multiple event handlers.
/// This allows us to broadcast state updates to both the UI (via Tauri) 
/// and internal services (loggers, monitors, records).
pub struct EventRegistry {
    handlers: RwLock<Vec<Arc<dyn AppEventHandle>>>,
}

impl EventRegistry {
    pub fn new() -> Self {
        Self {
            handlers: RwLock::new(Vec::new()),
        }
    }

    /// Register a new event handler.
    pub fn register(&self, handler: Arc<dyn AppEventHandle>) {
        let mut handlers = self.handlers.write();
        handlers.push(handler);
    }

    /// Clear all registered handlers.
    pub fn clear(&self) {
        let mut handlers = self.handlers.write();
        handlers.clear();
    }
}

impl AppEventHandle for EventRegistry {
    fn emit_state_update(&self, payload: AgentStateUpdate) {
        let handlers = self.handlers.read();
        for handler in handlers.iter() {
            handler.emit_state_update(payload.clone());
        }
    }

    fn emit_performance_metrics(&self, metrics: super::AgentPerformance) {
        let handlers = self.handlers.read();
        for handler in handlers.iter() {
            handler.emit_performance_metrics(metrics.clone());
        }
    }

    fn emit_state_update_with_token(&self, payload: AgentStateUpdate, token: Option<String>) {
        let handlers = self.handlers.read();
        for handler in handlers.iter() {
            handler.emit_state_update_with_token(payload.clone(), token.clone());
        }
    }
}

/// A specialized handle that just collects events in memory (for testing or auditing).
pub struct CollectorEventHandle {
    events: RwLock<Vec<AgentStateUpdate>>,
    metrics: RwLock<Vec<super::AgentPerformance>>,
}

impl CollectorEventHandle {
    pub fn new() -> Self {
        Self {
            events: RwLock::new(Vec::new()),
            metrics: RwLock::new(Vec::new()),
        }
    }

    pub fn take_events(&self) -> Vec<AgentStateUpdate> {
        let mut events = self.events.write();
        std::mem::take(&mut *events)
    }
}

impl AppEventHandle for CollectorEventHandle {
    fn emit_state_update(&self, payload: AgentStateUpdate) {
        let mut events = self.events.write();
        events.push(payload);
    }

    fn emit_performance_metrics(&self, metrics: super::AgentPerformance) {
        let mut m = self.metrics.write();
        m.push(metrics);
    }

    fn emit_state_update_with_token(&self, payload: AgentStateUpdate, _token: Option<String>) {
        self.emit_state_update(payload);
    }
}
