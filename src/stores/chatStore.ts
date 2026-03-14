import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ChatAttachment, ChatMessage } from "../types";

type ChatStore = {
  // Map of taskId -> messages
  messages: Record<string, ChatMessage[]>;
  pendingAttachments: ChatAttachment[];
  isRunning: boolean;
  activeSessionId: number | null;
  orchestrationMode: "direct" | "auto";
  autoRetryCount: number;
  maxAutoRetries: number;

  // Actions
  addMessage: (taskId: string, message: ChatMessage) => void;
  setMessages: (taskId: string, messages: ChatMessage[]) => void;
  updateMessage: (taskId: string, id: string, patch: Partial<ChatMessage>) => void;
  appendToMessage: (taskId: string, id: string, chunk: string) => void;
  clearMessages: (taskId: string) => void;
  
  setPendingAttachments: (attachments: ChatAttachment[]) => void;
  addPendingAttachment: (attachment: ChatAttachment) => void;
  removePendingAttachment: (path: string) => void;
  clearPendingAttachments: () => void;
  
  setRunning: (running: boolean) => void;
  setActiveSessionId: (sessionId: number | null) => void;
  setOrchestrationMode: (mode: "direct" | "auto") => void;
  setMaxAutoRetries: (count: number) => void;
  incrementAutoRetry: () => void;
  resetAutoRetry: () => void;

  // Helpers
  getTaskMessages: (taskId: string | null) => ChatMessage[];
};

const MAX_MESSAGES = 200;

export const useChatStore = create<ChatStore>()(
  persist(
    (set, get) => ({
      messages: {},
      pendingAttachments: [],
      isRunning: false,
      activeSessionId: null,
      orchestrationMode: "direct",
      autoRetryCount: 0,
      maxAutoRetries: 3,

      addMessage: (taskId, message) =>
        set((state) => {
          const list = state.messages[taskId] || [];
          const next = [...list, message];
          return {
            messages: {
              ...state.messages,
              [taskId]: next.length > MAX_MESSAGES ? next.slice(next.length - MAX_MESSAGES) : next,
            },
          };
        }),
      setMessages: (taskId, messages) =>
        set((state) => ({
          messages: {
            ...state.messages,
            [taskId]: messages.length > MAX_MESSAGES ? messages.slice(messages.length - MAX_MESSAGES) : messages,
          },
        })),
      updateMessage: (taskId, id, patch) =>
        set((state) => {
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
      appendToMessage: (taskId, id, chunk) =>
        set((state) => {
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
      clearMessages: (taskId) =>
        set((state) => ({
          messages: { ...state.messages, [taskId]: [] },
        })),

      setPendingAttachments: (pendingAttachments) => set({ pendingAttachments }),
      addPendingAttachment: (attachment) =>
        set((state) => ({
          pendingAttachments: [
            ...state.pendingAttachments.filter((x) => x.path !== attachment.path),
            attachment,
          ],
        })),
      removePendingAttachment: (path) =>
        set((state) => ({
          pendingAttachments: state.pendingAttachments.filter((attachment) => attachment.path !== path),
        })),
      clearPendingAttachments: () => set({ pendingAttachments: [] }),

      setRunning: (isRunning) => set({ isRunning }),
      setActiveSessionId: (activeSessionId) => set({ activeSessionId }),
      setOrchestrationMode: (orchestrationMode) => set({ orchestrationMode }),
      setMaxAutoRetries: (maxAutoRetries) => set({ maxAutoRetries }),
      incrementAutoRetry: () => set((state) => ({ autoRetryCount: state.autoRetryCount + 1 })),
      resetAutoRetry: () => set({ autoRetryCount: 0 }),

      getTaskMessages: (taskId) => (taskId ? get().messages[taskId] || [] : []),
    }),
    {
      name: "bmad-chat-storage",
      partialize: (state) => ({
        messages: state.messages,
        orchestrationMode: state.orchestrationMode,
      }),
    }
  )
);
