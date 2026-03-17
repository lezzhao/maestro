use crate::workflow::types::VerificationSummary;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ExecutionMode {
    Pty,
    Headless,
    Api,
    Cli,
    #[serde(rename = "workflow")]
    Workflow,
}

impl ExecutionMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            ExecutionMode::Pty => "pty",
            ExecutionMode::Headless => "headless",
            ExecutionMode::Api => "api",
            ExecutionMode::Cli => "cli",
            ExecutionMode::Workflow => "workflow",
        }
    }
}

// Ensure the parser handles the string names backward-compatibly
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ExecutionStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled,
}

impl ExecutionStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            ExecutionStatus::Pending => "pending",
            ExecutionStatus::Running => "running",
            ExecutionStatus::Completed => "completed",
            ExecutionStatus::Failed => "failed",
            ExecutionStatus::Cancelled => "cancelled",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Execution {
    // Execution is the backend runtime/persistence unit under a task.
    // UI `run` should be treated as an execution projection, not a separate source of truth.
    #[serde(alias = "run_id")] // For backward compatibility with UnifiedRunRecord
    pub id: String,
    pub engine_id: String,
    #[serde(default)]
    pub task_id: String,
    #[serde(default)]
    pub source: String,
    pub mode: ExecutionMode,
    pub status: ExecutionStatus,
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub cwd: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub created_at: i64,
    #[serde(default)]
    pub updated_at: i64,
    pub log_path: Option<String>,
    #[serde(default)]
    pub output_preview: String,
    pub verification: Option<VerificationSummary>,
    pub error: Option<String>,
    pub result: Option<String>,
    pub native_ref: Option<String>,
}

impl Execution {
    pub fn new(id: String, engine_id: String, mode: ExecutionMode) -> Self {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;

        Self {
            id,
            engine_id,
            task_id: String::new(),
            source: String::new(),
            mode,
            status: ExecutionStatus::Pending,
            command: String::new(),
            cwd: String::new(),
            model: String::new(),
            created_at: now,
            updated_at: now,
            log_path: None,
            output_preview: String::new(),
            verification: None,
            error: None,
            result: None,
            native_ref: None,
        }
    }

    pub fn start(&mut self) {
        self.status = ExecutionStatus::Running;
        self.touch();
    }

    pub fn complete(&mut self) {
        self.status = ExecutionStatus::Completed;
        self.touch();
    }

    pub fn fail(&mut self, reason: String) {
        self.status = ExecutionStatus::Failed;
        self.error = Some(reason);
        self.touch();
    }

    pub fn cancel(&mut self) {
        self.status = ExecutionStatus::Cancelled;
        self.touch();
    }

    /// Complete with output and optional verification (for workflow/chat)
    pub fn complete_with(
        &mut self,
        output_preview: impl Into<String>,
        verification: Option<VerificationSummary>,
    ) {
        self.output_preview = output_preview.into();
        self.verification = verification;
        self.complete();
    }

    /// Fail with reason and optional output preview
    pub fn fail_with(&mut self, reason: impl Into<String>, output_preview: impl Into<String>) {
        self.output_preview = output_preview.into();
        self.fail(reason.into());
    }

    fn touch(&mut self) {
        self.updated_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
    }
}
