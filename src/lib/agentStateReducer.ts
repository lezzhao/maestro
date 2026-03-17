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

export type AgentStateUpdate =
  | { type: "run_created"; task_id: string; run: TaskRunPayload }
  | { type: "run_finished"; task_id: string; run_id: string; status: string; error?: string | null }
  | { type: "messages_updated"; task_id: string; messages: PersistedMessagePayload[] }
  | { type: "task_created"; task: TaskRecord }
  | { type: "task_state_changed"; task_id: string; from_state: string; to_state: string }
  | { type: "task_deleted"; task_id: string }
  | { type: "execution_started"; task_id: string; run_id: string; mode: string }
  | { type: "execution_cancelled"; task_id: string; run_id: string }
  | { type: "execution_output_chunk"; task_id: string; run_id: string; chunk: string };

type AgentReducerDeps = {
  createRun: (run: TaskRun) => void;
  finishRun: (runId: string, status: "done" | "error" | "stopped", error?: string | null) => void;
  appendRunTranscript: (runId: string, content: string) => void;
  setMessages: (taskId: string, messages: ChatMessage[]) => void;
  setTasks: (tasks: TaskViewModel[]) => void;
  updateTask: (id: string, patch: Partial<AppTask>) => void;
  getAppState: () => { tasks: TaskViewModel[]; activeTaskId: string | null };
  setAppState: (next: { tasks: TaskViewModel[]; activeTaskId: string | null }) => void;
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

function toMessages(messages: PersistedMessagePayload[]): ChatMessage[] {
  return messages.map((m) => ({
    id: m.id,
    role: m.role as "user" | "assistant" | "system" | "plan",
    content: m.content,
    timestamp: Date.now(),
    attachments: [] as ChatAttachment[],
    status: "done" as const,
  }));
}

export function applyAgentStateUpdate(payload: AgentStateUpdate, deps: AgentReducerDeps) {
  switch (payload.type) {
    case "run_created":
      deps.createRun(toTaskRun(payload.run));
      break;
    case "run_finished":
      deps.finishRun(payload.run_id, payload.status === "done" ? "done" : "error", payload.error ?? null);
      break;
    case "messages_updated":
      deps.setMessages(payload.task_id, toMessages(payload.messages));
      break;
    case "task_created": {
      const existing = deps.getAppState().tasks;
      if (!existing.some((t) => t.id === payload.task.id)) {
        deps.setTasks([toTaskViewModel(payload.task), ...existing]);
      }
      break;
    }
    case "task_state_changed":
      deps.updateTask(payload.task_id, {
        status: mapTaskStateToStatus(payload.to_state),
        updated_at: Date.now(),
      });
      break;
    case "task_deleted": {
      const current = deps.getAppState();
      const remaining = current.tasks.filter((t) => t.id !== payload.task_id);
      deps.setAppState({
        tasks: remaining,
        activeTaskId:
          current.activeTaskId === payload.task_id
            ? (remaining[0]?.id ?? null)
            : current.activeTaskId,
      });
      break;
    }
    case "execution_cancelled":
      deps.finishRun(payload.run_id, "stopped", null);
      break;
    case "execution_output_chunk":
      deps.appendRunTranscript(payload.run_id, payload.chunk);
      break;
    case "execution_started":
    default:
      break;
  }
}
