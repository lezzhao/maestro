import { useCallback } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import type {
  ChatApiRequest,
  ChatExecuteApiResult,
  ChatExecuteCliRequest,
  ChatExecuteCliResult,
  ChatExecuteStopRequest,
  ChatSendRequest,
  ChatSessionMeta,
  ChatSpawnRequest,
  ChatStopRequest,
} from "../types";

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

  const executeApi = useCallback(
    async (
      request: ChatApiRequest,
      onChunk: (chunk: string) => void,
    ): Promise<ChatExecuteApiResult> => {
      const onData = new Channel<string>();
      onData.onmessage = (chunk) => onChunk(chunk);
      return invoke<ChatExecuteApiResult>("chat_execute_api", { request, onData });
    },
    [],
  );

  const stopApi = useCallback(async (request: ChatExecuteStopRequest) => {
    await invoke("chat_execute_api_stop", { request });
  }, []);

  const executeCli = useCallback(
    async (
      request: ChatExecuteCliRequest,
      onChunk: (chunk: string) => void,
    ): Promise<ChatExecuteCliResult> => {
      const onData = new Channel<string>();
      onData.onmessage = (chunk) => onChunk(chunk);
      return invoke<ChatExecuteCliResult>("chat_execute_cli", { request, onData });
    },
    [],
  );

  const stopCli = useCallback(async (request: ChatExecuteStopRequest) => {
    await invoke("chat_execute_cli_stop", { request });
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
    executeApi,
    stopApi,
    executeCli,
    stopCli,
    saveLastConversation,
    loadLastConversation,
  };
}
