import { invoke } from "@tauri-apps/api/core";
import { ChatMessage } from "../../types";
import { ChatStore, MAX_MESSAGES } from "./types";

export const createMessageActions = (
  set: (fn: (state: ChatStore) => Partial<ChatStore>) => void,
  _get: () => ChatStore
) => ({
  addMessage: (taskId: string, message: ChatMessage) =>
    set((state: ChatStore) => {
      const list = state.messages[taskId] || [];
      const next = [...list, message];
      return {
        messages: {
          ...state.messages,
          [taskId]: next.length > MAX_MESSAGES ? next.slice(next.length - MAX_MESSAGES) : next,
        },
      };
    }),

  setMessages: (taskId: string, messages: ChatMessage[]) =>
    set((state: ChatStore) => ({
      messages: {
        ...state.messages,
        [taskId]: messages.length > MAX_MESSAGES ? messages.slice(messages.length - MAX_MESSAGES) : messages,
      },
    })),

  updateMessage: (taskId: string, id: string, patch: Partial<ChatMessage>) =>
    set((state: ChatStore) => {
      const list = state.messages[taskId];
      if (!list) return state;
      const idx = list.findIndex((message) => message.id === id);
      if (idx === -1) return state;
      const next = list.slice();
      next[idx] = { ...next[idx], ...patch };
      return {
        messages: { ...state.messages, [taskId]: next },
      };
    }),

  resolveChoice: (taskId: string, messageId: string, optionId: string) =>
    set((state: ChatStore) => {
      const list = state.messages[taskId];
      if (!list) return state;
      const idx = list.findIndex((m) => m.id === messageId);
      if (idx === -1) return state;
      const msg = list[idx];
      const choice = msg.meta?.choice;
      if (!choice) return state;
      
      const option = choice.options.find(o => o.id === optionId);
      if (option && option.action.kind === "resolve_pending_tool") {
        invoke("chat_resolve_pending_tool", {
          request_id: option.action.requestId,
          approved: option.action.approved
        }).catch(err => console.error("Failed to resolve pending tool:", err));
      }

      const next = list.slice();
      next[idx] = {
        ...msg,
        meta: {
          ...msg.meta,
          choice: { ...choice, status: "resolved", selectedOptionId: optionId },
        },
      };
      return { messages: { ...state.messages, [taskId]: next } };
    }),

  appendToMessage: (taskId: string, id: string, chunk: string) =>
    set((state: ChatStore) => {
      const list = state.messages[taskId];
      if (!list) return state;
      const idx = list.findIndex((message) => message.id === id);
      if (idx === -1) return state;
      const next = list.slice();
      const target = next[idx];
      next[idx] = { ...target, content: `${target.content}${chunk}` };
      return {
        messages: { ...state.messages, [taskId]: next },
      };
    }),

  clearMessages: (taskId: string) =>
    set((state: ChatStore) => ({
      messages: { ...state.messages, [taskId]: [] },
    })),
});
