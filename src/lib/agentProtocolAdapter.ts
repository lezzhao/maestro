import type { AppTask, ChatAttachment, ChatMessage, TaskRecord, TaskRun, TaskViewModel } from "../types";

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
  return {
    id: p.id,
    taskId: p.task_id,
    engineId: p.engine_id,
    mode: p.mode as "api" | "cli",
    status: p.status as TaskRun["status"],
    createdAt: p.created_at,
    startedAt: p.started_at,
    endedAt: p.ended_at ?? undefined,
    error: p.error ?? undefined,
  };
}

export function toTaskViewModel(p: TaskRecord): TaskViewModel {
  const created = p.created_at ? new Date(p.created_at).getTime() : Date.now();
  const updated = p.updated_at ? new Date(p.updated_at).getTime() : Date.now();
  return {
    id: p.id,
    name: p.title,
    sessionId: null,
    activeExecId: null,
    activeRunId: null,
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
  return messages.map((m) => ({
    id: m.id,
    role: m.role as "user" | "assistant" | "system" | "plan",
    content: m.content,
    timestamp: Date.now(),
    attachments: [] as ChatAttachment[],
    status: "done" as const,
  }));
}
