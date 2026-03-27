import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useChatStore } from "../stores/chatStore";

export function useTaskChatState(taskId: string | null) {
  return useChatStore(useShallow((state) => {
    const messages = state.getTaskMessages(taskId);
    const isRunning = state.getTaskRunning(taskId);
    const latestRun = state.getLatestRun(taskId);
    const latestRunEvents = state.getRunEvents(latestRun?.id || null);
    const latestTranscript = state.getRunTranscript(latestRun?.id || null);
    const pendingAttachments = state.getTaskPendingAttachments(taskId);
    return {
      messages,
      isRunning,
      latestRun,
      latestRunEvents,
      latestTranscript,
      pendingAttachments,
    };
  }));
}

export function useTaskMessages(taskId: string | null) {
  return useChatStore((state) => state.getTaskMessages(taskId));
}

export function useTaskRunning(taskId: string | null) {
  return useChatStore((state) => state.getTaskRunning(taskId));
}

export function useTaskAssistantTokenTotals(taskId: string | null) {
  const messages = useTaskMessages(taskId);
  return useMemo(() => {
    return messages.reduce(
      (acc, message) => {
        if (message.role === "assistant" && message.tokenEstimate) {
          acc.input += message.tokenEstimate.approx_input_tokens;
          acc.output += message.tokenEstimate.approx_output_tokens;
        }
        return acc;
      },
      { input: 0, output: 0 },
    );
  }, [messages]);
}
