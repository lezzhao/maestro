import { ChatAttachment } from "../../types";
import { ChatStore, EMPTY_ATTACHMENTS, EMPTY_MESSAGES } from "./types";

export const createAttachmentActions = (
  set: (fn: (state: ChatStore) => Partial<ChatStore>) => void,
  get: () => ChatStore
) => ({
  setPendingAttachments: (taskId: string, attachments: ChatAttachment[]) =>
    set((state: ChatStore) => ({
      pendingAttachments: { ...state.pendingAttachments, [taskId]: attachments },
    })),
  addPendingAttachment: (taskId: string, attachment: ChatAttachment) =>
    set((state: ChatStore) => ({
      pendingAttachments: {
        ...state.pendingAttachments,
        [taskId]: [
          ...(state.pendingAttachments[taskId] || []).filter((x) => x.path !== attachment.path),
          attachment,
        ],
      },
    })),
  removePendingAttachment: (taskId: string, path: string) =>
    set((state: ChatStore) => ({
      pendingAttachments: {
        ...state.pendingAttachments,
        [taskId]: (state.pendingAttachments[taskId] || []).filter(
          (attachment) => attachment.path !== path,
        ),
      },
    })),
  addPendingAttachments: (taskId: string, attachments: ChatAttachment[]) =>
    set((state: ChatStore) => {
      const current = state.pendingAttachments[taskId] || [];
      const paths = new Set(current.map((x) => x.path));
      const filteredNew = attachments.filter((x) => !paths.has(x.path));
      return {
        pendingAttachments: {
          ...state.pendingAttachments,
          [taskId]: [...current, ...filteredNew],
        },
      };
    }),
  clearPendingAttachments: (taskId: string) =>
    set((state: ChatStore) => ({
      pendingAttachments: { ...state.pendingAttachments, [taskId]: [] },
    })),

  getTaskMessages: (taskId: string | null) => (taskId ? get().messages[taskId] ?? EMPTY_MESSAGES : EMPTY_MESSAGES),
  getTaskPendingAttachments: (taskId: string | null) =>
    taskId ? get().pendingAttachments[taskId] ?? EMPTY_ATTACHMENTS : EMPTY_ATTACHMENTS,
  getTaskRunning: (taskId: string | null) => (taskId ? Boolean(get().taskRunning[taskId]) : false),
});
