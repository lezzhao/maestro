import { create } from "zustand";
import { persist } from "zustand/middleware";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { ChatStore, EMPTY_MESSAGES, EMPTY_ATTACHMENTS, EMPTY_RUN_EVENTS, EMPTY_TRANSCRIPT } from "./types";
import { TaskRun } from "../../types";
import { createConversationActions } from "./conversation-actions";
import { createMessageActions } from "./message-actions";
import { createRunActions } from "./run-actions";
import { createAttachmentActions } from "./attachment-actions";

export const useChatStore = create<ChatStore>()(
  persist(
    (set, get) => ({
      // --- State ---
      messages: {},
      pendingAttachments: {},
      taskRunning: {},
      runsById: {},
      runOrderByTask: {},
      eventsByRun: {},
      transcriptByRun: {},
      artifactsByRun: {},
      verificationsByRun: {},
      activeSessionId: null,
      taskActiveRunId: {},
      taskActiveAssistantMsgId: {},
      taskExecutionPhase: {},
      orchestrationMode: "direct",
      autoRetryCount: 0,
      maxAutoRetries: 3,

      conversationsByTask: {},
      activeConversationId: {},
      
      taskStateToken: {},
      pendingPermissionRequest: null,

      // --- Actions ---
      ...createConversationActions(set, get),
      ...createMessageActions(set, get),
      ...createRunActions(set, get),
      ...createAttachmentActions(set, get),

      // --- Permission Actions (Integrated here for simplicity) ---
      setPendingPermissionRequest: (pendingPermissionRequest) => set({ pendingPermissionRequest }),
      resolvePermission: async (approved: boolean, editedArguments?: string) => {
        const req = get().pendingPermissionRequest;
        if (!req) return;

        try {
          await invoke("chat_resolve_pending_tool", {
            request_id: req.requestId,
            approved,
            edited_arguments: editedArguments || null,
          });
          set({ pendingPermissionRequest: null });
        } catch (error) {
          console.error("Failed to resolve permission:", error);
          toast.error(`Permission Resolution Failed: ${String(error)}`);
        }
      },
      setTaskStateToken: (taskId: string, token: string) => set((state) => ({
        taskStateToken: { ...state.taskStateToken, [taskId]: token }
      })),

      // --- Getters ---
      getTaskMessages: (taskId) => get().messages[taskId || "global"] || EMPTY_MESSAGES,
      getTaskPendingAttachments: (taskId) => get().pendingAttachments[taskId || "global"] || EMPTY_ATTACHMENTS,
      getTaskRunning: (taskId) => !!get().taskRunning[taskId || "global"],
      getTaskRuns: (taskId) => {
        const ids = get().runOrderByTask[taskId || "global"] || [];
        return ids.map(id => get().runsById[id]).filter((run): run is TaskRun => !!run);
      },
      getLatestRun: (taskId) => {
        const ids = get().runOrderByTask[taskId || "global"] || [];
        if (ids.length === 0) return null;
        return get().runsById[ids[ids.length - 1]] || null;
      },
      getTaskRunEvents: (taskId) => {
        const run = get().getLatestRun(taskId);
        if (!run) return EMPTY_RUN_EVENTS;
        return get().eventsByRun[run.id] || EMPTY_RUN_EVENTS;
      },
      getRunEvents: (runId) => runId ? get().eventsByRun[runId] || EMPTY_RUN_EVENTS : EMPTY_RUN_EVENTS,
      getRunTranscript: (runId) => runId ? get().transcriptByRun[runId] || EMPTY_TRANSCRIPT : EMPTY_TRANSCRIPT,
      getRunVerification: (runId) => runId ? get().verificationsByRun[runId] || null : null,
    }),
    {
      name: "maestro-chat-storage",
      partialize: (state) => ({
        orchestrationMode: state.orchestrationMode,
      }),
    }
  )
);

// Re-export types for convenience
export * from "./types";
