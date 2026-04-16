pub mod mode;
pub mod session;

use std::path::PathBuf;
use crate::core::error::CoreError;
use mode::HarnessMode;
use session::{HarnessSession, get_harness_session_by_task, save_harness_session};

pub struct HarnessManager {
    db_path: PathBuf,
}

impl HarnessManager {
    pub fn new(db_path: PathBuf) -> Self {
        Self { db_path }
    }

    /// Retrieves an existing session or initializes a new one for a task.
    pub fn get_or_create_session(&self, task_id: &str) -> Result<HarnessSession, CoreError> {
        if let Some(session) = get_harness_session_by_task(&self.db_path, task_id)? {
            Ok(session)
        } else {
            let session = HarnessSession {
                id: uuid::Uuid::new_v4().to_string(),
                task_id: task_id.to_string(),
                current_mode: HarnessMode::Strategic,
                strategic_plan: None,
                metadata_json: None,
            };
            save_harness_session(&self.db_path, &session)?;
            Ok(session)
        }
    }

    /// Transitions the harness to a new mode.
    pub fn transition(&self, task_id: &str, new_mode: HarnessMode) -> Result<(), CoreError> {
        let mut session = self.get_or_create_session(task_id)?;
        session.current_mode = new_mode;
        save_harness_session(&self.db_path, &session)?;
        Ok(())
    }

    /// Updates the strategic plan for the session.
    pub fn update_plan(&self, task_id: &str, plan: &str) -> Result<(), CoreError> {
        let mut session = self.get_or_create_session(task_id)?;
        session.strategic_plan = Some(plan.to_string());
        save_harness_session(&self.db_path, &session)?;
        Ok(())
    }
}
