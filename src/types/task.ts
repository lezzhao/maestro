import { VerificationSummary } from "./workflow";

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

export type TaskRunEvent = RunEvent;

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
