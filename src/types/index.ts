export type EngineProfile = {
  id: string;
  display_name: string;
  command: string;
  model?: string;
  args: string[];
  env: Record<string, string>;
  supports_headless: boolean;
  headless_args: string[];
  ready_signal?: string | null;
  execution_mode?: "cli" | "api";
  api_provider?: "openai-compatible" | "anthropic" | null;
  api_base_url?: string | null;
  api_key?: string | null;
};

export type EngineConfig = {
  id: string;
  plugin_type: string;
  display_name: string;
  profiles?: Record<string, EngineProfile>;
  active_profile_id?: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  exit_command: string;
  exit_timeout_ms: number;
  supports_headless: boolean;
  headless_args: string[];
  ready_signal?: string | null;
  execution_mode?: "cli" | "api";
  api_provider?: "openai-compatible" | "anthropic" | null;
  api_base_url?: string | null;
  api_key?: string | null;
  icon: string;
};

export type EnginePreflightResult = {
  engine_id: string;
  profile_id?: string;
  command_exists: boolean;
  auth_ok: boolean;
  supports_headless: boolean;
  notes: string;
  cached?: boolean;
  checked_at_ms?: number;
};

export type EngineModelListResult = {
  engine_id: string;
  profile_id: string;
  models: string[];
  source: "cli" | "builtin";
  notes: string;
};

export type EngineModelListState = EngineModelListResult & {
  cached: boolean;
  fetched_at_ms: number;
};

export type PtySessionInfo = {
  session_id: string;
  os_pid?: number | null;
  task_id?: string | null;
};

export type ProcessStats = {
  session_id?: string | null;
  os_pid?: number | null;
  cpu_percent: number;
  memory_mb: number;
  running: boolean;
};

export type WorkflowStep = {
  engine: string;
  profile_id?: string;
  prompt: string;
  completion_signal?: string;
  timeout_ms?: number;
};

export type WorkflowRunRequest = {
  name: string;
  steps: WorkflowStep[];
  task_id?: string | null;
};

export type WorkflowProgressEvent = {
  workflow_name: string;
  step_index: number;
  total_steps: number;
  engine: string;
  status: string;
  message: string;
  token_estimate?: TokenEstimate | null;
};

export type WorkflowStepResult = {
  engine: string;
  mode: string;
  fallback: boolean;
  success: boolean;
  completion_matched: boolean;
  failure_reason?: string | null;
  duration_ms: number;
  output: string;
  verification?: VerificationSummary | null;
};

export type WorkflowRunResult = {
  workflow_name: string;
  used_fallback: boolean;
  completed: boolean;
  archive_path: string;
  step_results: WorkflowStepResult[];
  verification?: VerificationSummary | null;
};

export type TokenEstimate = {
  input_chars: number;
  output_chars: number;
  approx_input_tokens: number;
  approx_output_tokens: number;
};

export type ChatAttachment = {
  name: string;
  path: string;
  snippet?: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "plan";
  content: string;
  timestamp: number;
  attachments?: ChatAttachment[];
  status?: "streaming" | "done" | "error";
  tokenEstimate?: TokenEstimate;
  durationMs?: number;
  meta?: {
    auto?: boolean;
    engineId?: string;
    profileId?: string;
    eventType?: "status" | "tool" | "notice";
    eventStatus?: "pending" | "done" | "error";
    toolName?: string;
  };
};

export type TestCaseResult = {
  name: string;
  status: "passed" | "failed" | "skipped";
  duration_ms?: number | null;
  error?: string | null;
};

export type TestSuiteResult = {
  name: string;
  total_cases: number;
  passed_cases: number;
  failed_cases: number;
  skipped_cases: number;
  duration_ms?: number | null;
  cases: TestCaseResult[];
};

export type TestRunSummary = {
  framework: "vitest" | "jest" | "playwright" | "cypress" | "unknown";
  success: boolean;
  total_suites: number;
  passed_suites: number;
  failed_suites: number;
  total_cases: number;
  passed_cases: number;
  failed_cases: number;
  skipped_cases: number;
  duration_ms?: number | null;
  suites: TestSuiteResult[];
  raw_summary?: string | null;
};

export type VerificationSummary = {
  has_verification: boolean;
  test_run?: TestRunSummary | null;
  source?: string | null;
  notes?: string | null;
};

export type TaskRunStatus = "pending" | "running" | "done" | "error" | "stopped";

export type RunEvent = {
  id: string;
  taskId: string;
  runId: string;
  kind: "status" | "notice" | "error";
  status: "pending" | "done" | "error" | "stopped";
  message: string;
  createdAt: number;
  engineId?: string;
  mode?: "api" | "cli";
};

export type RunTranscriptChunk = {
  id: string;
  runId: string;
  content: string;
  createdAt: number;
};

export type RunArtifact = {
  id: string;
  runId: string;
  kind: "log" | "diff" | "file" | "note";
  label: string;
  value: string;
  createdAt: number;
};

export type RunVerificationRef = {
  runId: string;
  verification: VerificationSummary;
  updatedAt: number;
};

/** Frontend view of Execution (backend authoritative run record). */
export type TaskRun = {
  id: string;
  taskId: string;
  engineId: string;
  mode: "api" | "cli";
  status: TaskRunStatus;
  createdAt: number;
  startedAt: number;
  endedAt?: number;
  error?: string | null;
};

export type TaskRunEvent = RunEvent;

export type ChatSpawnRequest = {
  engine_id: string;
  profile_id?: string | null;
  task_id?: string | null;
  cols?: number;
  rows?: number;
};

export type ChatSendRequest = {
  session_id: string;
  content: string;
  append_newline?: boolean;
};

export type ChatStopRequest = {
  session_id: string;
};

export type ChatSessionMeta = {
  session_id: string;
  task_id?: string | null;
  engine_id: string;
  profile_id: string;
  ready_signal?: string | null;
};

export type ChatApiMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatApiRequest = {
  engine_id: string;
  profile_id?: string | null;
  task_id?: string | null;
  message_ids?: string[];
  messages?: ChatApiMessage[];
  max_input_tokens?: number;
  max_messages?: number;
};

export type ChatExecuteApiResult = {
  exec_id: string;
  run_id: string;
  engine_id: string;
  profile_id: string;
};

export type ChatExecuteCliRequest = {
  engine_id: string;
  profile_id?: string | null;
  task_id?: string | null;
  prompt: string;
  is_continuation: boolean;
};

export type ChatExecuteCliResult = {
  exec_id: string;
  run_id: string;
  pid?: number | null;
  engine_id: string;
  profile_id: string;
};

export type ChatExecuteStopRequest = {
  exec_id: string;
};

export type StepRunRequest = {
  workflow_name: string;
  step: WorkflowStep;
  step_index: number;
  total_steps: number;
};

export type StepRunResult = WorkflowStepResult & {
  token_estimate: TokenEstimate;
};

export type WorkflowArchiveEntry = {
  name: string;
  path: string;
  modified_ts: number;
  completed: boolean;
  workflow_name: string;
  failed_count: number;
};

export type WorkflowArchiveFailedStep = {
  index: number;
  engine: string;
  mode: string;
  status: "failed" | "not-matched";
  reason: string;
};

export type WorkflowArchiveDetail = {
  name: string;
  path: string;
  modified_ts: number;
  workflow_name: string;
  completed: boolean;
  used_fallback: boolean;
  step_count: number;
  failed_count: number;
  failed_steps: WorkflowArchiveFailedStep[];
  verification?: VerificationSummary | null;
};

export type WorkflowArchiveExportResult = {
  path: string;
  count: number;
};

export type FileChangeStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "conflict"
  | "ignored"
  | "unknown";

export type FileChange = {
  status: FileChangeStatus;
  path: string;
};

export type WorkflowFullArchive = {
  request?: {
    name?: string;
    steps?: Array<{
      engine?: string;
      profile_id?: string;
      prompt?: string;
      completion_signal?: string;
      timeout_ms?: number;
    }>;
  };
  result?: {
    workflow_name?: string;
    completed?: boolean;
    archive_path?: string;
    step_results?: Array<{
      engine?: string;
      mode?: string;
      output?: string;
      success?: boolean;
      completion_matched?: boolean;
      failure_reason?: string | null;
      verification?: VerificationSummary | null;
    }>;
    verification?: VerificationSummary | null;
  };
};

export type EngineHistoryEntry = {
  id: string;
  engine_id: string;
  profile_id: string;
  workflow_name: string;
  step_index: number;
  mode: string;
  success: boolean;
  completion_matched: boolean;
  failure_reason?: string | null;
  duration_ms: number;
  summary: string;
  created_ts: number;
  detail_path: string;
};

export type EngineHistoryDetail = {
  id: string;
  engine_id: string;
  profile_id: string;
  workflow_name: string;
  step_index: number;
  mode: string;
  created_ts: number;
  prompt: string;
  output: string;
};

export type EngineHistoryPage = {
  entries: EngineHistoryEntry[];
  total: number;
  page: number;
  page_size: number;
};

export type ProjectStackResult = {
  path: string;
  stacks: string[];
};

export type ProjectSetResult = {
  path: string;
  stacks: string[];
};

export type TaskStats = {
  cpu_percent: number;
  memory_mb: number;
  approx_input_tokens: number;
  approx_output_tokens: number;
};

export type TaskRuntimeBinding = {
  /** Runtime binding: currently bound session for the task. */
  sessionId: string | null;
  /** Runtime binding: currently bound execution id for the task. */
  activeExecId?: string | null;
  /** Runtime binding: currently active run id for the task. */
  activeRunId?: string | null;
};

export type TaskViewState = {
  id: string;
  name: string;
  status: "idle" | "running" | "error" | "completed" | "needs_review" | "verified";
  gitChanges: FileChange[];
  stats: TaskStats;
  created_at: number;
  updated_at: number;
};

export type TaskViewModel = TaskViewState & TaskRuntimeBinding;

export type AppTask = TaskViewModel;

/** Backend authoritative task entity projection. */
export type TaskRecord = {
  id: string;
  title: string;
  description: string;
  current_state: string;
  workspace_boundary: string;
  created_at: string;
  updated_at: string;
};

/** Frontend UI projection that enriches TaskRecord with runtime-only fields. */

export type EngineRecommendation = {
  engine_id: string;
  reason: string;
};

export type CliSessionListItem = {
  session_id: string;
  engine_id: string;
  task_id?: string;
  source?: string;
  status: string;
  mode: string;
  command: string;
  cwd: string;
  model: string;
  run_count: number;
  send_count: number;
  created_at: number;
  updated_at: number;
  log_size: number;
  is_last: boolean;
};

export type CliPruneResult = {
  deleted_sessions: number;
  deleted_logs: number;
};
