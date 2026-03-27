import { useCallback } from "react";
import {
  executeChatApiCommand,
  executeChatCliCommand,
  loadLastConversationCommand,
  saveLastConversationCommand,
  sendChatMessageCommand,
  spawnChatSessionCommand,
  stopChatApiCommand,
  stopChatCliCommand,
  stopChatSessionCommand,
  submitChatChoiceCommand,
} from "./chat-commands";
import type {
  ChatApiRequest,
  ChatExecuteApiResult,
  ChatExecuteCliRequest,
  ChatExecuteCliResult,
  ChatExecuteStopRequest,
  ChatSubmitChoiceRequest,
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
      return spawnChatSessionCommand(request, onChunk);
    },
    [],
  );

  const sendMessage = useCallback(async (request: ChatSendRequest) => {
    await sendChatMessageCommand(request);
  }, []);

  const stopSession = useCallback(async (request: ChatStopRequest) => {
    await stopChatSessionCommand(request);
  }, []);

  const executeApi = useCallback(
    async (
      request: ChatApiRequest,
      onChunk: (chunk: string) => void,
    ): Promise<ChatExecuteApiResult> => {
      return executeChatApiCommand(request, onChunk);
    },
    [],
  );

  const stopApi = useCallback(async (request: ChatExecuteStopRequest) => {
    await stopChatApiCommand(request);
  }, []);

  const executeCli = useCallback(
    async (
      request: ChatExecuteCliRequest,
      onChunk: (chunk: string) => void,
    ): Promise<ChatExecuteCliResult> => {
      return executeChatCliCommand(request, onChunk);
    },
    [],
  );

  const stopCli = useCallback(async (request: ChatExecuteStopRequest) => {
    await stopChatCliCommand(request);
  }, []);

  const saveLastConversation = useCallback(async (payload: unknown) => {
    await saveLastConversationCommand(payload);
  }, []);

  const loadLastConversation = useCallback(async () => {
    return loadLastConversationCommand();
  }, []);

  const submitChoice = useCallback(async (request: ChatSubmitChoiceRequest) => {
    await submitChatChoiceCommand(request);
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
    submitChoice,
  };
}
