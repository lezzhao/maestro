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
 */
import type { ChatMessage, TaskRecord, TaskRun, TaskViewModel } from "../types";
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
  | { type: "execution_output_chunk"; task_id: string; run_id: string; chunk: string }
  | { type: "engine_preflight_complete"; engine_id: string; result: import("../types").EnginePreflightResult }
  | { type: "workspace_created"; workspace: import("../types").Workspace }
  | { type: "workspace_updated"; workspace: import("../types").Workspace }
  | { type: "workspace_deleted"; workspace_id: string }
  | { type: "execution_token_usage"; task_id: string; run_id: string; input_tokens: number; output_tokens: number };

type AgentReducerDeps = {
  createRun: (run: TaskRun) => void;
  finishRun: (runId: string, status: "done" | "error" | "stopped", error?: string | null) => void;
  appendRunTranscript: (runId: string, content: string) => void;
  setMessages: (taskId: string, messages: ChatMessage[]) => void;
  updateMessage: (taskId: string, id: string, patch: Partial<ChatMessage>) => void;
  appendToMessage: (taskId: string, id: string, chunk: string) => void;
  setTasks: (tasks: TaskViewModel[]) => void;
  updateTaskRecord: (id: string, patch: Partial<import("../types").TaskViewState>) => void;
  updateTaskRuntimeBinding: (taskId: string, binding: import("../types").TaskRuntimeBinding) => void;
  setTaskResolvedRuntimeContext: (taskId: string, context: import("../types").ResolvedRuntimeContext) => void;
  getAppState: () => { tasks: TaskViewModel[]; activeTaskId: string | null };
  setAppState: (next: { tasks: TaskViewModel[]; activeTaskId: string | null }) => void;
  setEnginePreflight: (engineId: string, result: import("../types").EnginePreflightResult) => void;
  addWorkspace: (workspace: import("../types").Workspace) => void;
  updateWorkspace: (workspace: import("../types").Workspace) => void;
  removeWorkspace: (id: string) => void;

  // Active execution tracking
  setActiveRunId: (taskId: string, runId: string | null) => void;
  setActiveAssistantMsgId: (taskId: string, messageId: string | null) => void;
  getChatState: () => {
    taskActiveRunId: Record<string, string | null>;
    taskActiveAssistantMsgId: Record<string, string | null>;
  };
  setTaskRunning: (taskId: string, running: boolean) => void;
  setRunning: (running: boolean) => void;
  setExecutionPhase: (taskId: string, phase: "idle" | "connecting" | "sending" | "streaming" | "completed" | "error") => void;
};

export function applyAgentStateUpdate(payload: AgentStateUpdate, deps: AgentReducerDeps) {
  switch (payload.type) {
    case "execution_started":
      deps.setRunning(true);
      deps.setTaskRunning(payload.task_id, true);
      deps.setActiveRunId(payload.task_id, payload.run_id);
      deps.setExecutionPhase(payload.task_id, "streaming");
      break;
    case "run_created":
      deps.createRun(toTaskRun(payload.run));
      break;
    case "run_finished":
    case "execution_cancelled": {
      const isCancelled = payload.type === "execution_cancelled";
      const statusValue = isCancelled ? "stopped" : (payload.status === "done" ? "done" : "error");
      const errorMsg = (payload as { error?: string | null }).error ?? null;
      deps.finishRun(payload.run_id, statusValue as "done" | "error" | "stopped", errorMsg);
      
      const chat = deps.getChatState();
      // If this run matches the active run for the task, clear it.
      if (chat.taskActiveRunId[payload.task_id] === payload.run_id) {
        deps.setExecutionPhase(payload.task_id, isCancelled || statusValue === "done" ? "completed" : "error");
        deps.setActiveRunId(payload.task_id, null);
        const msgId = chat.taskActiveAssistantMsgId[payload.task_id];
        if (msgId) {
          deps.updateMessage(payload.task_id, msgId, { status: (isCancelled || statusValue === "done") ? "done" : "error" });
          deps.setActiveAssistantMsgId(payload.task_id, null);
        }
        deps.setTaskRunning(payload.task_id, false);
        deps.setRunning(false); 
      }
      break;
    }
    case "execution_output_chunk": {
      deps.appendRunTranscript(payload.run_id, payload.chunk);
      const activeMsgId = deps.getChatState().taskActiveAssistantMsgId[payload.task_id];
      if (activeMsgId) {
        deps.appendToMessage(payload.task_id, activeMsgId, payload.chunk);
      }
      break;
    }
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
      deps.updateTaskRecord(payload.task_id, {
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
    case "engine_preflight_complete":
      deps.setEnginePreflight(payload.engine_id, payload.result);
      break;
    case "workspace_created":
      deps.addWorkspace(payload.workspace);
      break;
    case "workspace_updated":
      deps.updateWorkspace(payload.workspace);
      break;
    case "workspace_deleted":
      deps.removeWorkspace(payload.workspace_id);
      break;
    case "execution_token_usage": {
      const msgId = deps.getChatState().taskActiveAssistantMsgId[payload.task_id];
      if (msgId) {
        deps.updateMessage(payload.task_id, msgId, {
          tokenEstimate: {
            approx_input_tokens: payload.input_tokens,
            approx_output_tokens: payload.output_tokens,
            input_chars: 0,
            output_chars: 0,
          },
        });
      }
      const appState = deps.getAppState();
      const task = appState.tasks.find((t) => t.id === payload.task_id);
      if (task) {
        const stats = { ...task.stats };
        stats.approx_input_tokens = (stats.approx_input_tokens || 0) + payload.input_tokens;
        stats.approx_output_tokens = (stats.approx_output_tokens || 0) + payload.output_tokens;
        deps.updateTaskRecord(payload.task_id, { stats });
      }
      break;
    }
    default:
      break;
  }
}
