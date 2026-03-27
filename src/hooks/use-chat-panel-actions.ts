import { useCallback } from "react";
import { toast } from "sonner";
import { useChatAgent } from "./useChatAgent";
import { useChatStore } from "../stores/chatStore";
import type { ChatChoiceAction, ChatChoiceOption, ChatMessage } from "../types";

interface UseChatPanelActionsParams {
  activeTaskId: string | null;
  isRunning: boolean;
  setShowSettings: (value: boolean) => void;
  onSetExecutionMode: (mode: "api" | "cli") => Promise<void>;
}

function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function executeChoiceAction(
  action: ChatChoiceAction,
  ctx: {
    setShowSettings: (value: boolean) => void;
    onSetExecutionMode: (mode: "api" | "cli") => Promise<void>;
  },
) {
  switch (action.kind) {
    case "open_settings":
      ctx.setShowSettings(true);
      break;
    case "switch_execution_mode":
      void ctx.onSetExecutionMode(action.mode);
      break;
    case "open_external_url":
      if (isSafeUrl(action.url)) {
        window.open(action.url, "_blank", "noopener,noreferrer");
      } else {
        console.warn("阻止打开非安全 URL:", action.url);
      }
      break;
  }
}

export function useChatPanelActions({
  activeTaskId,
  isRunning,
  setShowSettings,
  onSetExecutionMode,
}: UseChatPanelActionsParams) {
  const { saveLastConversation, submitChoice } = useChatAgent();
  const resolveChoice = useChatStore((s) => s.resolveChoice);
  const clearMessages = useChatStore((s) => s.clearMessages);
  const clearTaskRuns = useChatStore((s) => s.clearTaskRuns);

  const handleChoiceSelect = useCallback(
    async (message: ChatMessage, option: ChatChoiceOption) => {
      if (!activeTaskId || !message.meta?.choice) return;

      resolveChoice(activeTaskId, message.id, option.id);
      executeChoiceAction(option.action, { setShowSettings, onSetExecutionMode });

      try {
        const updatedMessages = useChatStore.getState().messages[activeTaskId] || [];
        await Promise.all([
          saveLastConversation({
            task_id: activeTaskId,
            messages: updatedMessages,
            saved_at: Date.now(),
          }),
          submitChoice({
            task_id: activeTaskId,
            message_id: message.id,
            option_id: option.id,
            option_label: option.label,
          }),
        ]);
      } catch (error) {
        console.error("提交选择结果失败:", error);
      }
    },
    [
      activeTaskId,
      onSetExecutionMode,
      resolveChoice,
      saveLastConversation,
      setShowSettings,
      submitChoice,
    ],
  );

  const handleClearChat = useCallback(async () => {
    if (!activeTaskId || isRunning) return;
    clearMessages(activeTaskId);
    clearTaskRuns(activeTaskId);
    try {
      await saveLastConversation({
        task_id: activeTaskId,
        messages: [],
        saved_at: Date.now(),
      });
    } catch (error) {
      console.error("清空聊天记录后同步失败:", error);
      toast.error("清空记录已完成，但同步后端状态失败");
    }
  }, [
    activeTaskId,
    clearMessages,
    clearTaskRuns,
    isRunning,
    saveLastConversation,
  ]);

  return {
    handleChoiceSelect,
    handleClearChat,
  };
}
