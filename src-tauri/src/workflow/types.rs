use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowRunRequest {
    pub name: String,
    pub steps: Vec<WorkflowRunStep>,
    #[serde(default)]
    pub task_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowRunStep {
    pub engine: String,
    pub profile_id: Option<String>,
    pub prompt: String,
    pub completion_signal: Option<String>,
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WorkflowProgressEvent {
    pub workflow_name: String,
    pub step_index: usize,
    pub total_steps: usize,
    pub engine: String,
    pub status: String,
    pub message: String,
    pub token_estimate: Option<TokenEstimate>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WorkflowStepResult {
    pub engine: String,
    pub mode: String,
    pub status: String,
    #[serde(default)]
    pub success: bool,
    pub fallback: bool,
    pub completion_matched: bool,
    pub failure_reason: Option<String>,
    pub duration_ms: u128,
    pub output: String,
    pub verification: Option<VerificationSummary>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WorkflowRunResult {
    pub workflow_name: String,
    pub used_fallback: bool,
    pub completed: bool,
    pub archive_path: String,
    pub step_results: Vec<WorkflowStepResult>,
    pub verification: Option<VerificationSummary>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TokenEstimate {
    pub input_chars: usize,
    pub output_chars: usize,
    pub approx_input_tokens: usize,
    pub approx_output_tokens: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepRunRequest {
    pub workflow_name: String,
    pub step: WorkflowRunStep,
    pub step_index: usize,
    pub total_steps: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct StepRunResult {
    pub engine: String,
    pub mode: String,
    pub status: String,
    #[serde(default)]
    pub success: bool,
    pub fallback: bool,
    pub completion_matched: bool,
    pub failure_reason: Option<String>,
    pub duration_ms: u128,
    pub output: String,
    pub token_estimate: TokenEstimate,
    pub verification: Option<VerificationSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct VerificationSummary {
    pub has_verification: bool,
    pub test_run: Option<TestRunSummary>,
    pub source: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestRunSummary {
    pub framework: String,
    pub success: bool,
    pub total_suites: usize,
    pub passed_suites: usize,
    pub failed_suites: usize,
    pub total_cases: usize,
    pub passed_cases: usize,
    pub failed_cases: usize,
    pub skipped_cases: usize,
    pub duration_ms: Option<u128>,
    pub suites: Vec<TestSuiteResult>,
    pub raw_summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestSuiteResult {
    pub name: String,
    pub total_cases: usize,
    pub passed_cases: usize,
    pub failed_cases: usize,
    pub skipped_cases: usize,
    pub duration_ms: Option<u128>,
    pub cases: Vec<TestCaseResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestCaseResult {
    pub name: String,
    pub status: String,
    pub duration_ms: Option<u128>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowArchiveEntry {
    pub name: String,
    pub path: String,
    pub modified_ts: u64,
    pub completed: bool,
    pub workflow_name: String,
    pub failed_count: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct WorkflowArchiveFailedStep {
    pub index: usize,
    pub engine: String,
    pub mode: String,
    pub status: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct WorkflowArchiveExportResult {
    pub path: String,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct WorkflowArchiveDetail {
    pub name: String,
    pub path: String,
    pub modified_ts: u64,
    pub workflow_name: String,
    pub completed: bool,
    pub used_fallback: bool,
    pub step_count: usize,
    pub failed_count: usize,
    pub failed_steps: Vec<WorkflowArchiveFailedStep>,
    pub verification: Option<VerificationSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineHistoryEntry {
    pub id: String,
    pub engine_id: String,
    pub profile_id: String,
    pub workflow_name: String,
    pub step_index: usize,
    pub mode: String,
    pub status: String,
    #[serde(default)]
    pub success: bool,
    pub completion_matched: bool,
    pub failure_reason: Option<String>,
    pub duration_ms: u128,
    pub summary: String,
    pub created_ts: u64,
    pub detail_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineHistoryDetail {
    pub id: String,
    pub engine_id: String,
    pub profile_id: String,
    pub workflow_name: String,
    pub step_index: usize,
    pub mode: String,
    pub created_ts: u64,
    pub prompt: String,
    pub output: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct EngineHistoryPage {
    pub entries: Vec<EngineHistoryEntry>,
    pub total: usize,
    pub page: usize,
    pub page_size: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatSpawnRequest {
    pub engine_id: String,
    pub profile_id: Option<String>,
    pub task_id: Option<String>,
    pub cols: Option<u16>,
    pub rows: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatSendRequest {
    pub session_id: String,
    pub content: String,
    pub append_newline: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatStopRequest {
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ChatSessionMeta {
    pub session_id: String,
    pub task_id: Option<String>,
    pub engine_id: String,
    pub profile_id: String,
    pub ready_signal: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatApiMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatApiRequest {
    pub engine_id: String,
    pub profile_id: Option<String>,
    pub task_id: Option<String>,
    #[serde(default)]
    pub message_ids: Vec<String>,
    #[serde(default)]
    pub messages: Vec<ChatApiMessage>,
    pub max_input_tokens: Option<usize>,
    pub max_messages: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ChatExecuteApiResult {
    pub exec_id: String,
    pub run_id: String,
    pub engine_id: String,
    pub profile_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatExecuteCliRequest {
    pub engine_id: String,
    pub profile_id: Option<String>,
    pub task_id: Option<String>,
    pub prompt: String,
    pub is_continuation: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ChatExecuteCliResult {
    pub exec_id: String,
    pub run_id: String,
    pub pid: Option<u32>,
    pub engine_id: String,
    pub profile_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatExecuteStopRequest {
    pub exec_id: String,
}
