import { invoke } from "@tauri-apps/api/core";
import {
  conversationList,
  conversationLoadMessages,
  conversationCreate,
  conversationDelete,
  conversationUpdateTitle,
} from "../../hooks/commands/conversation-commands";
import type { ChatStore } from "./types";

export const createConversationActions = (
  set: (fn: (state: ChatStore) => Partial<ChatStore>) => void,
  get: () => ChatStore
) => ({
  setConversations: (taskId: string, convs: import("../../types/index").Conversation[]) =>
    set((state: ChatStore) => ({
      conversationsByTask: { ...state.conversationsByTask, [taskId]: convs },
    })),

  setActiveConversationId: (taskId: string, id: string | null) =>
    set((state: ChatStore) => ({
      activeConversationId: { ...state.activeConversationId, [taskId]: id },
    })),

  refreshConversations: async (taskId: string | null) => {
    const convs = await conversationList(taskId);
    set((state: ChatStore) => ({
      conversationsByTask: { ...state.conversationsByTask, [taskId || "global"]: convs },
    }));
  },

  switchConversation: async (taskId: string | null, conversationId: string | null) => {
    const id = taskId || "global";
    if (!conversationId) {
      set((state: ChatStore) => ({
        activeConversationId: { ...state.activeConversationId, [id]: null },
        messages: { ...state.messages, [id]: [] },
      }));
      return;
    }

    const msgs = await conversationLoadMessages(conversationId);
    set((state: ChatStore) => ({
      activeConversationId: { ...state.activeConversationId, [id]: conversationId },
      messages: { ...state.messages, [id]: msgs },
    }));
  },

  createNewConversation: async (taskId: string | null, engineId: string, profileId?: string | null) => {
    const id = await conversationCreate({
      taskId: taskId || null,
      title: "新对话",
      engineId,
      profileId: profileId || null,
    });
    await get().refreshConversations(taskId);
    await get().switchConversation(taskId, id);
    return id;
  },

  deleteConversation: async (taskId: string | null, conversationId: string) => {
    await conversationDelete(conversationId);
    const id = taskId || "global";
    if (get().activeConversationId[id] === conversationId) {
      get().switchConversation(taskId, null);
    }
    await get().refreshConversations(taskId);
  },

  updateConversationTitle: async (conversationId: string, title: string) => {
    await conversationUpdateTitle(conversationId, title);
    updateConversationInState(set, conversationId, { title });
  },

  generateTitle: async (conversationId: string) => {
    try {
      const newTitle = await invoke<string>("conversation_derive_title_heuristic", {
        conversationId,
      });
      updateConversationInState(set, conversationId, { title: newTitle });
      return newTitle;
    } catch (error) {
      console.error("Failed to generate title:", error);
      return null;
    }
  },
});

function updateConversationInState(
  set: (fn: (state: ChatStore) => Partial<ChatStore>) => void,
  conversationId: string,
  updates: Partial<import("../../types/index").Conversation>
) {
  set((state: ChatStore) => {
    const next = { ...state.conversationsByTask };
    for (const key in next) {
      next[key] = (next[key] || []).map((c) =>
        c.id === conversationId ? { ...c, ...updates } : c
      );
    }
    return { conversationsByTask: next };
  });
}
