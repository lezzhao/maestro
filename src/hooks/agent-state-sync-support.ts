import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../stores/appStore";
import { useChatStore } from "../stores/chatStore";
import {
  applyAgentStateUpdate,
  type AgentStateUpdate,
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
): (payload: AgentStateUpdate) => void {
  return (payload: AgentStateUpdate) => {
    if (!payload || typeof payload !== "object") return;
    const appState = useAppStore.getState();
    const chatState = useChatStore.getState();
    applyAgentStateUpdate(payload, {
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
    });
  };
}

export async function bootstrapAgentState(): Promise<void> {
  const [taskRecords, workspaces, lastConversation] = await Promise.all([
    invoke<TaskRecord[]>("task_list"),
    invoke<Workspace[]>("workspace_list"),
    invoke<unknown | null>("chat_load_last_conversation"),
  ]);
  const taskModels = buildTaskModels(taskRecords);
  useAppStore.getState().setTasks(taskModels);
  useAppStore.getState().setWorkspaces(workspaces);
  restoreLastConversation(taskModels, lastConversation);
}
