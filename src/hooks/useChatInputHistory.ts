import { useCallback, useEffect, useRef } from "react";
import { useChatStore } from "../stores/chatStore";
import { useChatAgent } from "./useChatAgent";

export function useChatInputHistory(activeTaskId: string | null, isRunning: boolean) {
  const saveTimerRef = useRef<number | null>(null);
  const setMessages = useChatStore((s) => s.setMessages);
  
  const { saveLastConversation } = useChatAgent();

  const persistConversation = useCallback(async () => {
    if (!activeTaskId) return;
    try {
      const allMessages = useChatStore.getState().messages[activeTaskId] || [];
      await saveLastConversation({ messages: allMessages, saved_at: Date.now() });
    } catch {
      // 忽略持久化失败
    }
  }, [activeTaskId, saveLastConversation]);

  // Messages count trigger for debounced save
  const messageCount = useChatStore((s) => s.getTaskMessages(activeTaskId).length);

  useEffect(() => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(
      () => {
        void persistConversation();
      },
      isRunning ? 1200 : 350,
    );
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [isRunning, messageCount, persistConversation]);

  const handleRetry = useCallback(
    (messageId: string, setInput: (val: string) => void) => {
      if (!activeTaskId) return;
      const allMessages = useChatStore.getState().messages[activeTaskId] || [];
      const idx = allMessages.findIndex((m) => m.id === messageId);
      if (idx <= 0) return;
      const prevUserMessage = allMessages
        .slice(0, idx)
        .reverse()
        .find((m) => m.role === "user");
      if (!prevUserMessage) return;
      const userMsgIdx = allMessages.findIndex((m) => m.id === prevUserMessage.id);
      setMessages(activeTaskId, allMessages.slice(0, userMsgIdx + 1));
      setInput(prevUserMessage.content);
    },
    [activeTaskId, setMessages],
  );

  const handleCopy = useCallback((content: string) => {
    void navigator.clipboard.writeText(content);
  }, []);

  return { handleRetry, handleCopy };
}
