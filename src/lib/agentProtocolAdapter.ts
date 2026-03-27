import type {
  AppTask,
  ChatAttachment,
  ChatMessage,
  TaskRecord,
  TaskRun,
  TaskViewModel,
} from "../types";

const VALID_ROLES = new Set(["user", "assistant", "system", "plan"]);
const VALID_RUN_MODES = new Set(["api", "cli"]);
const VALID_RUN_STATUSES = new Set(["running", "done", "error", "stopped"]);
const VALID_MESSAGE_STATUSES = new Set(["streaming", "done", "error"]);

export type TaskRunPayload = {
  id: string;
  task_id: string;
  engine_id: string;
  mode: string;
  status: string;
  created_at: number;
  started_at: number;
  ended_at?: number | null;
  error?: string | null;
};

export type PersistedMessagePayload = {
  id: string;
  role: string;
  content: string;
  timestamp?: number;
  status?: ChatMessage["status"];
  attachments?: ChatAttachment[];
  meta?: ChatMessage["meta"];
};

export function mapTaskStateToStatus(currentState: string): AppTask["status"] {
  switch (currentState) {
    case "PLANNING":
    case "IN_PROGRESS":
      return "running";
    case "CODE_REVIEW":
      return "needs_review";
    case "DONE":
      return "completed";
    default:
      return "idle";
  }
}

export function toTaskRun(p: TaskRunPayload): TaskRun {
  if (!VALID_RUN_MODES.has(p.mode)) {
    console.warn(`后端返回未知 run mode: "${p.mode}"，降级为 "cli"`);
  }
  if (!VALID_RUN_STATUSES.has(p.status)) {
    console.warn(`后端返回未知 run status: "${p.status}"，降级为 "error"`);
  }
  return {
    id: p.id,
    taskId: p.task_id,
    engineId: p.engine_id,
    mode: VALID_RUN_MODES.has(p.mode) ? (p.mode as "api" | "cli") : "cli",
    status: VALID_RUN_STATUSES.has(p.status) ? (p.status as TaskRun["status"]) : "error",
    createdAt: p.created_at,
    startedAt: p.started_at,
    endedAt: p.ended_at ?? undefined,
    error: p.error ?? undefined,
  };
}

export function toTaskViewModel(p: TaskRecord): TaskViewModel {
  const created = p.created_at ?? Date.now();
  const updated = p.updated_at ?? Date.now();
  return {
    id: p.id,
    name: p.title,
    engineId: p.engine_id,
    profileId: p.profile_id ?? null,
    workspaceId: p.workspace_id ?? null,
    sessionId: null,
    activeExecId: null,
    activeRunId: null,
    settings: p.settings ?? null,
    status: mapTaskStateToStatus(p.current_state),
    gitChanges: [],
    stats: {
      cpu_percent: 0,
      memory_mb: 0,
      approx_input_tokens: 0,
      approx_output_tokens: 0,
    },
    created_at: created,
    updated_at: updated,
  };
}

export function toMessages(messages: PersistedMessagePayload[]): ChatMessage[] {
  return messages.map((m) => {
    if (!VALID_ROLES.has(m.role)) {
      console.warn(`后端返回未知 message role: "${m.role}"，降级为 "system"`);
    }
    if (m.status && !VALID_MESSAGE_STATUSES.has(m.status)) {
      console.warn(`后端返回未知 message status: "${m.status}"，降级为 "done"`);
    }
    return {
      id: m.id,
      role: VALID_ROLES.has(m.role) ? (m.role as ChatMessage["role"]) : "system",
      content: m.content,
      timestamp: m.timestamp ?? Date.now(),
      attachments: m.attachments ?? ([] as ChatAttachment[]),
      status: m.status && VALID_MESSAGE_STATUSES.has(m.status) ? m.status : "done",
      meta: m.meta,
    };
  });
}
