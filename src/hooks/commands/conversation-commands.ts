import { invoke } from "@tauri-apps/api/core";
import { Conversation, ChatMessage } from "../../types";

export type ConversationCreateRequest = {
  taskId?: string | null;
  title: string;
  engineId: string;
  profileId?: string | null;
};

export async function conversationCreate(request: ConversationCreateRequest): Promise<string> {
  return invoke("conversation_create", { request });
}

export async function conversationList(taskId?: string | null): Promise<Conversation[]> {
  return invoke("conversation_list", { taskId });
}

export async function conversationLoadMessages(conversationId: string): Promise<ChatMessage[]> {
  return invoke("conversation_load_messages", { conversationId });
}

export async function conversationDelete(conversationId: string): Promise<void> {
  return invoke("conversation_delete", { conversationId });
}

export async function conversationUpdateTitle(conversationId: string, title: string): Promise<void> {
  return invoke("conversation_update_title", { conversationId, title });
}
