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
  | { type: "message_appended"; task_id: string; message: PersistedMessagePayload }
  | { type: "choice_resolved"; task_id: string; message_id: string; option_id: string }
  | { type: "task_created"; task: TaskRecord }
  | { type: "task_updated"; task: TaskRecord }
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
  | { type: "execution_token_usage"; task_id: string; run_id: string; input_tokens: number; output_tokens: number }
  | { type: "pending_approval"; task_id: string; request_id: string; tool_name: string; tool_input: string; message: string }
  | { type: "reasoning"; task_id: string; message_id: string; content: string }
  | { type: "tool_started"; task_id: string; message_id: string; tool_name: string; tool_input: string }
  | { type: "tool_finished"; task_id: string; message_id: string; tool_name: string; tool_output: string; success: boolean }
  | { type: "message_token_usage"; task_id: string; message_id: string; input_tokens: number; output_tokens: number; total_tokens: number };

export interface AgentStateEvent {
  payload: AgentStateUpdate;
  state_token?: string;
}

type AgentReducerDeps = {
  createRun: (run: TaskRun) => void;
  finishRun: (runId: string, status: "done" | "error" | "stopped", error?: string | null) => void;
  appendRunTranscript: (runId: string, content: string) => void;
  addMessage: (taskId: string, message: ChatMessage) => void;
  setMessages: (taskId: string, messages: ChatMessage[]) => void;
  updateMessage: (taskId: string, id: string, patch: Partial<ChatMessage>) => void;
  resolveChoice: (taskId: string, messageId: string, optionId: string) => void;
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
  setExecutionPhase: (taskId: string, phase: "idle" | "connecting" | "sending" | "streaming" | "completed" | "error") => void;
  setPendingPermissionRequest: (request: import("../stores/chat/types").PermissionRequest | null) => void;
  getTaskStateToken: (taskId: string) => string | undefined;
};

function toTaskRecordPatch(task: TaskRecord): Partial<import("../types").TaskViewState> {
  return {
    name: task.title,
    engineId: task.engine_id,
    profileId: task.profile_id ?? null,
    workspaceId: task.workspace_id ?? null,
    settings: task.settings ?? null,
    status: mapTaskStateToStatus(task.current_state),
    created_at: task.created_at ?? Date.now(),
    updated_at: task.updated_at ?? Date.now(),
  };
}

export function applyAgentStateUpdate(event: AgentStateEvent, deps: AgentReducerDeps) {
  const { payload, state_token } = event;

  // 1. Stale state guard: Check state_token for execution-scoped events
  const EXECUTION_SCOPED_EVENTS = ["execution_output_chunk", "run_finished", "execution_cancelled", "execution_token_usage", "reasoning"];
  if (state_token && EXECUTION_SCOPED_EVENTS.includes(payload.type) && "task_id" in payload) {
    const taskId = (payload as { task_id: string }).task_id;
    const currentToken = deps.getTaskStateToken(taskId);
    
    // ALLOW events if currentToken is empty (may happen during transition)
    // but strictly match if a token is present.
    if (currentToken && state_token !== currentToken) {
      console.warn(
        `[AgentStateSync] Ignoring stale execution event ${payload.type} for task ${taskId}. Expected ${currentToken}, got ${state_token}`
      );
      return;
    }
  }

  switch (payload.type) {
    case "execution_started":
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
      }
      break;
    }
    case "execution_output_chunk": {
      // Global sync only updates the run transcript (logs).
      // Chat message content is handled by the high-performance local channel in the orchestrator.
      deps.appendRunTranscript(payload.run_id, payload.chunk);
      break;
    }
    case "messages_updated":
      deps.setMessages(payload.task_id, toMessages(payload.messages));
      break;
    case "message_appended": {
      const [message] = toMessages([payload.message]);
      if (message) {
        deps.addMessage(payload.task_id, message);
      }
      break;
    }
    case "choice_resolved": {
      deps.resolveChoice(payload.task_id, payload.message_id, payload.option_id);
      break;
    }
    case "task_created": {
      const existing = deps.getAppState().tasks;
      if (!existing.some((t) => t.id === payload.task.id)) {
        deps.setTasks([toTaskViewModel(payload.task), ...existing]);
      }
      break;
    }
    case "task_updated": {
      const existing = deps.getAppState().tasks;
      if (!existing.some((t) => t.id === payload.task.id)) {
        deps.setTasks([toTaskViewModel(payload.task), ...existing]);
        break;
      }
      deps.updateTaskRecord(payload.task.id, toTaskRecordPatch(payload.task));
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
    case "pending_approval": {
      deps.setPendingPermissionRequest({
        requestId: payload.request_id,
        toolName: payload.tool_name,
        toolInput: payload.tool_input,
        message: payload.message,
      });
      break;
    }
    case "reasoning": {
      deps.updateMessage(payload.task_id, payload.message_id, {
        reasoning: payload.content,
      });
      break;
    }
    case "tool_started": {
      deps.updateMessage(payload.task_id, payload.message_id, {
        meta: {
          eventType: "tool",
          eventStatus: "pending",
          toolName: payload.tool_name,
          toolInput: payload.tool_input,
        },
      });
      break;
    }
    case "tool_finished": {
      deps.updateMessage(payload.task_id, payload.message_id, {
        meta: {
          eventType: "tool",
          eventStatus: payload.success ? "done" : "error",
          toolName: payload.tool_name,
          toolOutput: payload.tool_output,
        },
      });
      break;
    }
    case "message_token_usage": {
      deps.updateMessage(payload.task_id, payload.message_id, {
        meta: {
          usage: {
            input_tokens: payload.input_tokens,
            output_tokens: payload.output_tokens,
            total_tokens: payload.total_tokens,
          },
        },
      });
      break;
    }
    default:
      break;
  }
}
