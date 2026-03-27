import { Channel, invoke } from "@tauri-apps/api/core";
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

function createStringChannel(onChunk: (chunk: string) => void) {
  const onData = new Channel<string>();
  onData.onmessage = (chunk) => onChunk(chunk);
  return onData;
}

export function spawnChatSessionCommand(
  request: ChatSpawnRequest,
  onChunk: (chunk: string) => void,
) {
  const onData = createStringChannel(onChunk);
  return invoke<ChatSessionMeta>("chat_spawn", { request, onData });
}

export function sendChatMessageCommand(request: ChatSendRequest) {
  return invoke("chat_send", { request });
}

export function stopChatSessionCommand(request: ChatStopRequest) {
  return invoke("chat_stop", { request });
}

export function executeChatApiCommand(
  request: ChatApiRequest,
  onChunk: (chunk: string) => void,
) {
  const onData = createStringChannel(onChunk);
  return invoke<ChatExecuteApiResult>("chat_execute_api", { request, onData });
}

export function stopChatApiCommand(request: ChatExecuteStopRequest) {
  return invoke("chat_execute_api_stop", { request });
}

export function executeChatCliCommand(
  request: ChatExecuteCliRequest,
  onChunk: (chunk: string) => void,
) {
  const onData = createStringChannel(onChunk);
  return invoke<ChatExecuteCliResult>("chat_execute_cli", { request, onData });
}

export function stopChatCliCommand(request: ChatExecuteStopRequest) {
  return invoke("chat_execute_cli_stop", { request });
}

export function saveLastConversationCommand(payload: unknown) {
  return invoke("chat_save_last_conversation", { payload });
}

export function loadLastConversationCommand() {
  return invoke<unknown | null>("chat_load_last_conversation");
}

export function submitChatChoiceCommand(request: ChatSubmitChoiceRequest) {
  return invoke("chat_submit_choice", { request });
}
