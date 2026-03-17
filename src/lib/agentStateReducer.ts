/**
 * Agent state reducer: applies backend events to appStore/chatStore.
 *
 * Backend operations that MUST emit corresponding events for frontend sync:
 * - task_create -> task_created
 * - task_transition -> task_state_changed
 * - task_delete -> task_deleted
 * - task_switch_runtime_binding / task_update_runtime_binding -> task_runtime_binding_changed + task_runtime_context_resolved
 *
 * Event consumption priority: resolved context > binding > other.
 * Runtime display should prefer authoritative resolved context from backend, not self-assemble from binding.
 * DEPRECATED: task_engine_changed is never emitted; use task_runtime_binding_changed.
 */
import type { AppTask, ChatMessage, TaskRecord, TaskRun, TaskViewModel } from "../types";
import {
  mapTaskStateToStatus,
  toMessages,
  toTaskRun,
  toTaskViewModel,
  type PersistedMessagePayload,
  type TaskRunPayload,
} from "./agentProtocolAdapter";

export { mapTaskStateToStatus, toTaskRun, toTaskViewModel } from "./agentProtocolAdapter";

export type AgentStateUpdate =
  | { type: "run_created"; task_id: string; run: TaskRunPayload }
  | { type: "run_finished"; task_id: string; run_id: string; status: string; error?: string | null }
  | { type: "messages_updated"; task_id: string; messages: PersistedMessagePayload[] }
  | { type: "task_created"; task: TaskRecord }
  | { type: "task_state_changed"; task_id: string; from_state: string; to_state: string }
  | { type: "task_deleted"; task_id: string }
  | { type: "task_runtime_binding_changed"; task_id: string; binding: import("../types").TaskRuntimeBinding }
  | { type: "task_runtime_context_resolved"; task_id: string; context: import("../types").ResolvedRuntimeContext }
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
  updateTaskRuntimeBinding: (taskId: string, binding: import("../types").TaskRuntimeBinding) => void;
  setTaskResolvedRuntimeContext: (taskId: string, context: import("../types").ResolvedRuntimeContext) => void;
  getAppState: () => { tasks: TaskViewModel[]; activeTaskId: string | null };
  setAppState: (next: { tasks: TaskViewModel[]; activeTaskId: string | null }) => void;
};

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
    case "task_runtime_binding_changed":
      deps.updateTaskRuntimeBinding(payload.task_id, {
        engineId: payload.binding.engineId ?? undefined,
        profileId: payload.binding.profileId ?? null,
        runtimeSnapshotId: payload.binding.runtimeSnapshotId,
        sessionId: payload.binding.sessionId ?? null,
      });
      break;
    case "task_runtime_context_resolved":
      deps.setTaskResolvedRuntimeContext(payload.task_id, payload.context);
      break;
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
