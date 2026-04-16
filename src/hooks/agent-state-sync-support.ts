import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../stores/appStore";
import { useChatStore } from "../stores/chatStore";
import {
  applyAgentStateUpdate,
  type AgentStateEvent,
  toTaskViewModel,
} from "../lib/agentStateReducer";
import { toMessages, type PersistedMessagePayload } from "../lib/agentProtocolAdapter";
import type { TaskRecord, Workspace } from "../types";

type AppendTranscriptChunk = (taskId: string, runId: string, content: string) => void;
type AppendMessageChunk = (taskId: string, msgId: string, content: string) => void;

function buildTaskModels(taskRecords: TaskRecord[]) {
  const chatMessages = useChatStore.getState().messages;
  return taskRecords.map((taskRecord) => {
    const viewModel = toTaskViewModel(taskRecord);
    let inputTokens = 0;
    let outputTokens = 0;
    const messages = chatMessages[viewModel.id];
    if (messages) {
      for (const message of messages) {
        if (message.tokenEstimate) {
          inputTokens += message.tokenEstimate.approx_input_tokens || 0;
          outputTokens += message.tokenEstimate.approx_output_tokens || 0;
        }
      }
    }
    viewModel.stats.approx_input_tokens = inputTokens;
    viewModel.stats.approx_output_tokens = outputTokens;
    return viewModel;
  });
}

function restoreLastConversation(
  taskModels: ReturnType<typeof buildTaskModels>,
  lastConversation: unknown,
) {
  if (!lastConversation || typeof lastConversation !== "object") return;
  const taskId = Reflect.get(lastConversation, "task_id");
  const messages = Reflect.get(lastConversation, "messages");
  const hasTask = typeof taskId === "string" && taskModels.some((task) => task.id === taskId);
  const localMessages = hasTask ? useChatStore.getState().messages[taskId] || [] : [];
  if (!hasTask || localMessages.length > 0 || !Array.isArray(messages)) return;
  useChatStore.getState().setMessages(
    taskId,
    toMessages(messages as PersistedMessagePayload[]),
  );
}

export function createAgentStateUpdateApplier(
  appendTranscriptChunk: AppendTranscriptChunk,
  appendMessageChunk: AppendMessageChunk,
): (event: AgentStateEvent) => void {
  return (event: AgentStateEvent) => {
    if (!event || typeof event !== "object" || !event.payload) return;
    const appState = useAppStore.getState();
    const chatState = useChatStore.getState();
    applyAgentStateUpdate(event, {
      createRun: chatState.createRun,
      finishRun: chatState.finishRun,
      appendRunTranscript: (runId, content) => appendTranscriptChunk("", runId, content),
      addMessage: chatState.addMessage,
      setMessages: chatState.setMessages,
      updateMessage: chatState.updateMessage,
      resolveChoice: chatState.resolveChoice,
      appendToMessage: (taskId, msgId, chunk) => appendMessageChunk(taskId, msgId, chunk),
      setTasks: appState.setTasks,
      updateTaskRecord: appState.updateTaskRecord,
      setTaskResolvedRuntimeContext: appState.setTaskResolvedRuntimeContext,
      updateTaskRuntimeBinding: appState.updateTaskRuntimeBinding,
      getAppState: () => useAppStore.getState(),
      setAppState: (next) => useAppStore.setState(next),
      setEnginePreflight: appState.setEnginePreflight,
      addWorkspace: appState.addWorkspace,
      updateWorkspace: (workspace) => appState.updateWorkspace(workspace.id, workspace),
      removeWorkspace: appState.removeWorkspace,
      setActiveRunId: chatState.setActiveRunId,
      setActiveAssistantMsgId: chatState.setActiveAssistantMsgId,
      getChatState: () => ({
        taskActiveRunId: useChatStore.getState().taskActiveRunId,
        taskActiveAssistantMsgId: useChatStore.getState().taskActiveAssistantMsgId,
      }),
      setTaskRunning: chatState.setTaskRunning,
      setExecutionPhase: chatState.setExecutionPhase,
      setPendingPermissionRequest: chatState.setPendingPermissionRequest,
      getTaskStateToken: (taskId) => useChatStore.getState().taskStateToken[taskId],
    });
  };
}

export async function bootstrapAgentState(): Promise<void> {
  const fetchState = async () => {
    return await Promise.all([
      invoke<TaskRecord[]>("task_list"),
      invoke<Workspace[]>("workspace_list"),
      invoke<unknown | null>("chat_load_last_conversation"),
    ]);
  };

  let [taskRecords, workspaces, lastConversation] = await fetchState();

  // Retry once after a short delay if everything is empty (handle backend seeding race)
  if (taskRecords.length === 0 && workspaces.length === 0) {
    console.warn("[bootstrap] App seems empty. Waiting for backend seeding...");
    await new Promise((resolve) => setTimeout(resolve, 800));
    [taskRecords, workspaces, lastConversation] = await fetchState();
  }

  const taskModels = buildTaskModels(taskRecords);
  const state = useAppStore.getState();

  state.setTasks(taskModels);
  state.setWorkspaces(workspaces);

  // --- Post-bootstrap Auto-selection ---
  // Ensure we have an active workspace if any exist
  let currentActiveWsId = state.activeWorkspaceId;
  const wsExists = workspaces.find((w) => w.id === currentActiveWsId);
  if (!wsExists && workspaces.length > 0) {
    currentActiveWsId = workspaces[0].id;
    state.setActiveWorkspaceId(currentActiveWsId);
    console.log("[bootstrap] Auto-selected workspace:", currentActiveWsId);
  }

  // Ensure we have an active task
  if (currentActiveWsId) {
    const currentActiveTaskId = state.activeTaskId;
    const taskExists = taskModels.find(
      (t) => t.id === currentActiveTaskId && (t.workspaceId === currentActiveWsId || !t.workspaceId)
    );
    if (!taskExists) {
      const bestTask = taskModels.find((t) => t.workspaceId === currentActiveWsId) || taskModels[0];
      if (bestTask) {
        state.setActiveTaskId(bestTask.id);
        console.log("[bootstrap] Auto-selected task:", bestTask.id);
      }
    }
  }

  restoreLastConversation(taskModels, lastConversation);
}
