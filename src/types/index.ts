/** Workspace: a top-level container grouping tasks and binding a working directory. */
export type Workspace = {
  id: string;
  name: string;
  /** If empty/undefined, workspace operates in Pure Chat mode. */
  workingDirectory?: string | null;
  icon?: string | null;
  color?: string | null;
  // Workspace-level config overrides
  preferredEngineId?: string | null;
  preferredProfileId?: string | null;
  specProvider?: "none" | "maestro" | "custom" | null;
  specMode?: string | null;
  specTargetIde?: string | null;
  settings?: string | null;
  /** Unix timestamp ms */
  createdAt: number;
  /** Unix timestamp ms */
  updatedAt: number;
};

export type AuthScheme = 
  | { type: "api_key"; config: { api_key: string; key_prefix?: string; is_secret: boolean } }
  | { type: "aws_bedrock"; config: { region: string; profile?: string; access_key_id?: string } }
  | { type: "azure_foundry"; config: { endpoint: string; deployment: string; key?: string } }
  | { type: "none"; config?: null };

export type ProviderMetadata = {
  provider_id: string;
  logo_key?: string;
  help_url?: string;
  category?: string;
};

/** Required fields for all engine profiles. */
export type EngineProfileBase = {
  id: string;
  display_name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  supports_headless: boolean;
  headless_args: string[];
};

/** Optional fields: CLI-specific (ready_signal) or API-specific (model, api_*). */
export type EngineProfileOptional = {
  model?: string | null;
  ready_signal?: string | null;
  execution_mode?: "cli" | "api";
  api_provider?: string | null;
  api_base_url?: string | null;
  api_key?: string | null;
  auth?: AuthScheme | null;
  metadata?: ProviderMetadata | null;
};

export type EngineProfile = EngineProfileBase & Partial<EngineProfileOptional>;

/** Engine-level config. Profile-level fields (command, args, env, etc.) live in profiles[profileId]. */
export type EngineConfig = {
  id: string;
  plugin_type: string;
  display_name: string;
  profiles?: Record<string, EngineProfile>;
  active_profile_id?: string;
  exit_command?: string;
  exit_timeout_ms?: number;
  icon: string;
  category?: string; // 'cloud', 'local', 'proxy'
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
  mime_type?: string;
  data?: string; // Base64
  snippet?: string;
};

export type ChatChoiceAction =
  | {
      kind: "open_settings";
    }
  | {
      kind: "switch_execution_mode";
      mode: "api" | "cli";
    }
  | {
      kind: "open_external_url";
      url: string;
    }
  | {
      kind: "resolve_pending_tool";
      requestId: string;
      approved: boolean;
    };

export type ChoiceVariant = "default" | "destructive" | "outline" | "secondary" | "ghost" | "link" | "primary-gradient";

export type ChatChoiceOption = {
  id: string;
  label: string;
  description?: string;
  variant?: ChoiceVariant;
  action: ChatChoiceAction;
};

export type ChatChoicePayload = {
  title: string;
  description?: string;
  options: ChatChoiceOption[];
  status?: "pending" | "resolved";
  selectedOptionId?: string;
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
  reasoning?: string;
  meta?: {
    auto?: boolean;
    engineId?: string;
    profileId?: string;
    eventType?: "status" | "tool" | "notice";
    eventStatus?: "pending" | "done" | "error";
    toolName?: string;
    toolInput?: string;
    toolOutput?: string;
    choice?: ChatChoicePayload;
    usage?: {
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
    };
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
  conversation_id?: string | null;
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

export type ChatApiAttachment = {
  name: string;
  path: string;
  mime_type: string;
  data: string; // Base64 encoded data
};

export type ChatApiMessage = {
  role: "system" | "user" | "assistant";
  content: string;
  attachments?: ChatApiAttachment[];
};

export type ChatApiRequest = {
  engine_id: string;
  profile_id?: string | null;
  task_id?: string | null;
  conversation_id?: string | null;
  message_ids?: string[];
  messages?: ChatApiMessage[];
  pinned_files?: string[];
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

export type ChatSubmitChoiceRequest = {
  task_id: string;
  message_id: string;
  option_id: string;
  option_label: string;
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

/**
 * JSON protocol: snake_case. Backend RuntimeResolvedFrom serialization.
 */
export type RuntimeResolvedFrom =
  | "snapshot"
  | "live_profile"
  | "fallback_profile"
  | "config_fallback";

/** Required fields for resolved execution context. Backend authoritative. */
export type ResolvedRuntimeContextBase = {
  taskId: string;
  engineId: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  executionMode: "cli" | "api";
  supportsHeadless: boolean;
  headlessArgs: string[];
  resolvedFrom: RuntimeResolvedFrom;
};

/** Optional fields: binding/snapshot ids, CLI exit config, or API config. */
export type ResolvedRuntimeContextOptional = {
  profileId?: string | null;
  snapshotId?: string | null;
  model?: string | null;
  apiProvider?: string | null;
  apiBaseUrl?: string | null;
  apiKey?: string | null;
  readySignal?: string | null;
  exitCommand?: string | null;
  exitTimeoutMs?: number | null;
};

/**
 * Resolved execution projection. Backend authoritative.
 * The exact parameters a task will execute with (command, args, env, model, etc.).
 * Do not mix with TaskRecord or TaskRuntimeBinding in business logic.
 */
export type ResolvedRuntimeContext = ResolvedRuntimeContextBase &
  Partial<ResolvedRuntimeContextOptional>;

/**
 * Runtime binding projection. Backend authoritative when from events.
 * engineId, profileId, runtimeSnapshotId from binding; sessionId/activeExecId from CLI.
 * Do not mix with TaskRecord or ResolvedRuntimeContext in business logic.
 */
export type TaskRuntimeBinding = {
  /** Backend authoritative engine id (from binding change event) */
  engineId?: string | null;
  /** Backend authoritative profile id (from binding change event) */
  profileId?: string | null;
  /** Backend authoritative runtime snapshot ID bound to this task */
  runtimeSnapshotId?: string | null;
  /** Currently bound CLI session for the task. */
  sessionId: string | null;
  /** Currently active execution id. */
  activeExecId?: string | null;
  /** Currently active run id. */
  activeRunId?: string | null;
};

/**
 * Task view state = TaskRecord projection + UI-derived fields.
 * Backend authoritative: id, name, engineId, profileId, status, created_at, updated_at.
 * UI-derived: gitChanges, stats.
 */
export interface TaskViewState {
  /** @backend authoritative */
  id: string;
  /** @backend authoritative */
  name: string;
  /** @backend authoritative */
  engineId: string;
  /** @backend authoritative - task-bound profile, created-time snapshot */
  profileId?: string | null;
  workspaceId?: string | null;
  settings?: string | null;
  /** @backend authoritative - derived from current_state */
  status: "idle" | "running" | "error" | "completed" | "needs_review" | "verified";
  /** @ui-derived - computed from git diff */
  gitChanges: FileChange[];
  /** @ui-derived - run stats */
  stats: TaskStats;
  /** @backend authoritative */
  created_at: number;
  /** @backend authoritative */
  updated_at: number;
}

export type TaskViewModel = TaskViewState & TaskRuntimeBinding;

/**
 * State layering for task:
 * - task record (TaskViewState): persisted entity fields
 * - runtime binding (TaskRuntimeBinding): runtime binding projection
 * - resolved runtime context (ResolvedRuntimeContext): executable context projection from backend
 *
 * Components should prefer selectors/hooks over consuming a fat AppTask. Use
 * updateTaskRecord / updateTaskRuntimeBinding / setTaskResolvedRuntimeContext per layer.
 */
export type AppTask = TaskViewModel & {
  resolvedRuntimeContext?: ResolvedRuntimeContext | null;
};

/**
 * Backend authoritative persisted task entity.
 * From DB; use for create/update/delete. Do not mix with runtime binding or resolved context.
 */
export interface TaskRecord {
  id: string;
  title: string;
  description: string;
  engine_id: string;
  current_state: string;
  workspace_boundary: string;
  profile_id?: string | null;
  workspace_id?: string | null;
  runtime_snapshot_id?: string | null;
  settings?: string | null;
  /** Unix timestamp in milliseconds. */
  created_at: number;
  /** Unix timestamp in milliseconds. */
  updated_at: number;
}

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

export type Conversation = {
  id: string;
  taskId?: string | null;
  title: string;
  engineId: string;
  profileId?: string | null;
  messageCount: number;
  summary?: string | null;
  createdAt: number;
  updatedAt: number;
};

export type ConversationRecord = Conversation;
