use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use super::AgentStateUpdate;

pub const AGENT_STATE_UPDATE_EVENT: &str = "agent://state-update";

/// Envelope for agent state update events. Wraps the internally tagged enum to inject global fields like `state_token`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentStateEvent {
    #[serde(flatten)]
    pub payload: AgentStateUpdate,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state_token: Option<String>,
}

/// Trait for emitting application events, decoupling business logic from Tauri.
pub trait AppEventHandle: Send + Sync {
    fn emit_state_update(&self, payload: AgentStateUpdate);
    fn emit_state_update_with_token(&self, payload: AgentStateUpdate, token: Option<String>);
    fn emit_performance_metrics(&self, metrics: super::AgentPerformance);
}

/// Default implementation for Tauri applications.
pub struct TauriEventHandle {
    pub handle: AppHandle,
}

impl TauriEventHandle {
    pub fn new(handle: AppHandle) -> Self {
        Self { handle }
    }

    pub fn arc(handle: AppHandle) -> Arc<dyn AppEventHandle> {
        Arc::new(Self::new(handle))
    }

    pub fn noop() -> Arc<dyn AppEventHandle> {
        Arc::new(NoopEventHandle)
    }
}

impl AppEventHandle for TauriEventHandle {
    fn emit_state_update(&self, payload: AgentStateUpdate) {
        emit_state_update(Some(&self.handle), payload, None);
    }
    
    fn emit_state_update_with_token(&self, payload: AgentStateUpdate, token: Option<String>) {
        emit_state_update(Some(&self.handle), payload, token);
    }

    fn emit_performance_metrics(&self, metrics: super::AgentPerformance) {
        emit_state_update(Some(&self.handle), AgentStateUpdate::PerformanceMetrics { metrics }, None);
    }
}

/// No-op implementation for testing and headless/daemon modes.
pub struct NoopEventHandle;

impl AppEventHandle for NoopEventHandle {
    fn emit_state_update(&self, _payload: AgentStateUpdate) {}
    fn emit_state_update_with_token(&self, _payload: AgentStateUpdate, _token: Option<String>) {}
    fn emit_performance_metrics(&self, _metrics: super::AgentPerformance) {}
}

/// Emit agent state update to frontend via AppHandle.
pub fn emit_state_update(app: Option<&AppHandle>, payload: AgentStateUpdate, state_token: Option<String>) {
    if let Some(handle) = app {
        let event = AgentStateEvent { payload, state_token };
        match serde_json::to_value(&event) {
            Ok(value) => {
                if let Err(e) = handle.emit(AGENT_STATE_UPDATE_EVENT, value) {
                    tracing::error!("agent state event emit failed: {e}");
                }
            }
            Err(e) => {
                tracing::error!("agent state event serialize failed, skipping emit: {e}");
            }
        }
    }
}
