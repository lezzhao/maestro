use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ExecutionMode {
    Pty,
    Headless,
    Api,
    Cli,
}

impl ExecutionMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            ExecutionMode::Pty => "pty",
            ExecutionMode::Headless => "headless",
            ExecutionMode::Api => "api",
            ExecutionMode::Cli => "cli",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
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
    pub id: String,
    pub engine_id: String,
    pub task_id: String,
    pub mode: ExecutionMode,
    pub status: ExecutionStatus,
    pub command: String,
    pub cwd: String,
    pub model: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub log_path: Option<String>,
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
            mode,
            status: ExecutionStatus::Pending,
            command: String::new(),
            cwd: String::new(),
            model: String::new(),
            created_at: now,
            updated_at: now,
            log_path: None,
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

    pub fn fail(&mut self) {
        self.status = ExecutionStatus::Failed;
        self.touch();
    }

    pub fn cancel(&mut self) {
        self.status = ExecutionStatus::Cancelled;
        self.touch();
    }

    fn touch(&mut self) {
        self.updated_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
    }
}
