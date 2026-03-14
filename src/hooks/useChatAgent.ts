import { useCallback } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import type { ChatSendRequest, ChatSessionMeta, ChatSpawnRequest, ChatStopRequest } from "../types";

export function useChatAgent() {
  const spawnSession = useCallback(
    async (
      request: ChatSpawnRequest,
      onChunk: (chunk: string) => void,
    ): Promise<ChatSessionMeta> => {
      const onData = new Channel<string>();
      onData.onmessage = (chunk) => onChunk(chunk);
      const result = await invoke<ChatSessionMeta>("chat_spawn", { request, onData });
      return result;
    },
    [],
  );

  const sendMessage = useCallback(async (request: ChatSendRequest) => {
    await invoke("chat_send", { request });
  }, []);

  const stopSession = useCallback(async (request: ChatStopRequest) => {
    await invoke("chat_stop", { request });
  }, []);

  const saveLastConversation = useCallback(async (payload: unknown) => {
    await invoke("chat_save_last_conversation", { payload });
  }, []);

  const loadLastConversation = useCallback(async () => {
    return invoke<unknown | null>("chat_load_last_conversation");
  }, []);

  return {
    spawnSession,
    sendMessage,
    stopSession,
    saveLastConversation,
    loadLastConversation,
  };
}
