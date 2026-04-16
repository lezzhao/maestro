use crate::core::MaestroCore;
use crate::core::error::CoreError;
use super::harness::mode::HarnessMode;
use super::harness::session::HarnessSession;

impl MaestroCore {
    /// Use-Case: Get or create a harness session for a task.
    pub fn harness_get_session(&self, task_id: &str) -> Result<HarnessSession, CoreError> {
        self.harness_mgr.get_or_create_session(task_id)
    }

    /// Use-Case: Transition harness to a new mode.
    pub fn harness_transition(&self, task_id: &str, new_mode: &str) -> Result<(), CoreError> {
        let mode = HarnessMode::from_str(new_mode).ok_or_else(|| CoreError::ValidationError {
            field: "new_mode".to_string(),
            message: format!("Invalid mode: {}", new_mode),
        })?;
        self.harness_mgr.transition(task_id, mode)
    }

    /// Use-Case: Update the persistent strategic plan.
    pub fn harness_update_plan(&self, task_id: &str, plan: &str) -> Result<(), CoreError> {
        self.harness_mgr.update_plan(task_id, plan)
    }
}
