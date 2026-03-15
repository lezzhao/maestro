import type { ChatMessage } from "../../types";

export function createMessage(
  role: ChatMessage["role"],
  content: string,
  patch?: Partial<ChatMessage>,
): ChatMessage {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    role,
    content,
    timestamp: Date.now(),
    ...patch,
  };
}
