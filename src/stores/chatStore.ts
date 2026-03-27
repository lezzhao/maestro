import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  ChatAttachment,
  ChatMessage,
  RunArtifact,
  RunEvent,
  TaskRun,
  TaskRunStatus,
  VerificationSummary,
} from "../types";

type ChatStore = {
  messages: Record<string, ChatMessage[]>;
  pendingAttachments: Record<string, ChatAttachment[]>;
  taskRunning: Record<string, boolean>;
  runsById: Record<string, TaskRun>;
  runOrderByTask: Record<string, string[]>;
  eventsByRun: Record<string, RunEvent[]>;
  transcriptByRun: Record<string, string>;
  artifactsByRun: Record<string, RunArtifact[]>;
  verificationsByRun: Record<string, VerificationSummary | null>;
  activeSessionId: string | null;
  taskActiveRunId: Record<string, string | null>;
  taskActiveAssistantMsgId: Record<string, string | null>;
  taskExecutionPhase: Record<string, "idle" | "connecting" | "sending" | "streaming" | "completed" | "error">;
  orchestrationMode: "direct" | "auto";
  autoRetryCount: number;
  maxAutoRetries: number;

  setActiveRunId: (taskId: string, runId: string | null) => void;
  setActiveAssistantMsgId: (taskId: string, messageId: string | null) => void;
  setExecutionPhase: (taskId: string, phase: "idle" | "connecting" | "sending" | "streaming" | "completed" | "error") => void;

  addMessage: (taskId: string, message: ChatMessage) => void;
  setMessages: (taskId: string, messages: ChatMessage[]) => void;
  updateMessage: (taskId: string, id: string, patch: Partial<ChatMessage>) => void;
  resolveChoice: (taskId: string, messageId: string, optionId: string) => void;
  appendToMessage: (taskId: string, id: string, chunk: string) => void;
  clearMessages: (taskId: string) => void;

  setPendingAttachments: (taskId: string, attachments: ChatAttachment[]) => void;
  addPendingAttachment: (taskId: string, attachment: ChatAttachment) => void;
  removePendingAttachment: (taskId: string, path: string) => void;
  clearPendingAttachments: (taskId: string) => void;

  setTaskRunning: (taskId: string, running: boolean) => void;
  createRun: (run: TaskRun) => void;
  updateRun: (runId: string, patch: Partial<TaskRun>) => void;
  finishRun: (runId: string, status: TaskRunStatus, error?: string | null) => void;
  addRunEvent: (runId: string, event: RunEvent) => void;
  appendRunTranscript: (runId: string, content: string) => void;
  addRunArtifact: (runId: string, artifact: RunArtifact) => void;
  setRunVerification: (runId: string, verification: VerificationSummary | null) => void;
  clearTaskRuns: (taskId: string) => void;
  clearRunEvents: (taskId: string) => void;
  setActiveSessionId: (sessionId: string | null) => void;
  setOrchestrationMode: (mode: "direct" | "auto") => void;
  setMaxAutoRetries: (count: number) => void;
  incrementAutoRetry: () => void;
  resetAutoRetry: () => void;

  getTaskMessages: (taskId: string | null) => ChatMessage[];
  getTaskPendingAttachments: (taskId: string | null) => ChatAttachment[];
  getTaskRunning: (taskId: string | null) => boolean;
  getTaskRuns: (taskId: string | null) => TaskRun[];
  getLatestRun: (taskId: string | null) => TaskRun | null;
  getTaskRunEvents: (taskId: string | null) => RunEvent[];
  getRunEvents: (runId: string | null) => RunEvent[];
  getRunTranscript: (runId: string | null) => string;
  getRunVerification: (runId: string | null) => VerificationSummary | null;
};

const MAX_MESSAGES = 200;
const EMPTY_MESSAGES: ChatMessage[] = [];
const EMPTY_ATTACHMENTS: ChatAttachment[] = [];
const MAX_RUN_EVENTS = 500;
const MAX_TRANSCRIPT_LENGTH = 65536; // Keep 64KB text max per run
const MAX_ARTIFACTS = 200;
const EMPTY_RUNS: TaskRun[] = [];
const EMPTY_RUN_EVENTS: RunEvent[] = [];
const EMPTY_TRANSCRIPT = "";

export const useChatStore = create<ChatStore>()(
  persist(
    (set, get) => ({
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

      setActiveRunId: (taskId, runId) =>
        set((state) => ({
          taskActiveRunId: { ...state.taskActiveRunId, [taskId]: runId },
        })),
      setActiveAssistantMsgId: (taskId, messageId) =>
        set((state) => ({
          taskActiveAssistantMsgId: { ...state.taskActiveAssistantMsgId, [taskId]: messageId },
        })),
      setExecutionPhase: (taskId, phase) =>
        set((state) => ({
          taskExecutionPhase: { ...state.taskExecutionPhase, [taskId]: phase },
        })),

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
      resolveChoice: (taskId, messageId, optionId) =>
        set((state) => {
          const list = state.messages[taskId];
          if (!list) return state;
          const idx = list.findIndex((m) => m.id === messageId);
          if (idx === -1) return state;
          const msg = list[idx];
          const choice = msg.meta?.choice;
          if (!choice) return state;
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

      setPendingAttachments: (taskId, attachments) =>
        set((state) => ({
          pendingAttachments: { ...state.pendingAttachments, [taskId]: attachments },
        })),
      addPendingAttachment: (taskId, attachment) =>
        set((state) => ({
          pendingAttachments: {
            ...state.pendingAttachments,
            [taskId]: [
              ...(state.pendingAttachments[taskId] || []).filter((x) => x.path !== attachment.path),
              attachment,
            ],
          },
        })),
      removePendingAttachment: (taskId, path) =>
        set((state) => ({
          pendingAttachments: {
            ...state.pendingAttachments,
            [taskId]: (state.pendingAttachments[taskId] || []).filter(
              (attachment) => attachment.path !== path,
            ),
          },
        })),
      clearPendingAttachments: (taskId) =>
        set((state) => ({
          pendingAttachments: { ...state.pendingAttachments, [taskId]: [] },
        })),

      setTaskRunning: (taskId, running) =>
        set((state) => ({
          taskRunning: {
            ...state.taskRunning,
            [taskId]: running,
          },
        })),
      createRun: (run) =>
        set((state) => {
          const order = state.runOrderByTask[run.taskId] || [];
          if (order.includes(run.id)) {
            return {
              runsById: {
                ...state.runsById,
                [run.id]: {
                  ...state.runsById[run.id],
                  ...run,
                },
              },
            };
          }
          return {
            runsById: {
              ...state.runsById,
              [run.id]: run,
            },
            runOrderByTask: {
              ...state.runOrderByTask,
              [run.taskId]: [...order, run.id],
            },
          };
        }),
      updateRun: (runId, patch) =>
        set((state) => {
          const run = state.runsById[runId];
          if (!run) return state;
          return {
            runsById: {
              ...state.runsById,
              [runId]: { ...run, ...patch },
            },
          };
        }),
      finishRun: (runId, status, error) =>
        set((state) => {
          const run = state.runsById[runId];
          if (!run) return state;
          return {
            runsById: {
              ...state.runsById,
              [runId]: {
                ...run,
                status,
                error: error ?? null,
                endedAt: Date.now(),
              },
            },
          };
        }),
      addRunEvent: (runId, event) =>
        set((state) => {
          const list = state.eventsByRun[runId] || [];
          const next = [...list, event];
          return {
            eventsByRun: {
              ...state.eventsByRun,
              [runId]:
                next.length > MAX_RUN_EVENTS ? next.slice(next.length - MAX_RUN_EVENTS) : next,
            },
          };
        }),
      appendRunTranscript: (runId, content) =>
        set((state) => {
          const current = state.transcriptByRun[runId] || "";
          const next = (current + content).slice(-MAX_TRANSCRIPT_LENGTH);
          return {
            transcriptByRun: {
              ...state.transcriptByRun,
              [runId]: next,
            },
          };
        }),
      addRunArtifact: (runId, artifact) =>
        set((state) => {
          const list = state.artifactsByRun[runId] || [];
          const next = [...list, artifact];
          return {
            artifactsByRun: {
              ...state.artifactsByRun,
              [runId]:
                next.length > MAX_ARTIFACTS ? next.slice(next.length - MAX_ARTIFACTS) : next,
            },
          };
        }),
      setRunVerification: (runId, verification) =>
        set((state) => ({
          verificationsByRun: {
            ...state.verificationsByRun,
            [runId]: verification,
          },
        })),
      clearTaskRuns: (taskId) =>
        set((state) => {
          const runIds = state.runOrderByTask[taskId] || [];
          const nextRuns = { ...state.runsById };
          const nextEvents = { ...state.eventsByRun };
          const nextTranscript = { ...state.transcriptByRun };
          const nextArtifacts = { ...state.artifactsByRun };
          const nextVerification = { ...state.verificationsByRun };
          runIds.forEach((runId) => {
            delete nextRuns[runId];
            delete nextEvents[runId];
            delete nextTranscript[runId];
            delete nextArtifacts[runId];
            delete nextVerification[runId];
          });
          return {
            runsById: nextRuns,
            eventsByRun: nextEvents,
            transcriptByRun: nextTranscript,
            artifactsByRun: nextArtifacts,
            verificationsByRun: nextVerification,
            runOrderByTask: {
              ...state.runOrderByTask,
              [taskId]: [],
            },
          };
        }),
      clearRunEvents: (taskId) =>
        set((state) => ({
          eventsByRun: Object.fromEntries(
            Object.entries(state.eventsByRun).map(([runId, events]) => {
              const run = state.runsById[runId];
              if (run?.taskId === taskId) {
                return [runId, []];
              }
              return [runId, events];
            }),
          ),
        })),
      setActiveSessionId: (activeSessionId) => set({ activeSessionId }),
      setOrchestrationMode: (orchestrationMode) => set({ orchestrationMode }),
      setMaxAutoRetries: (maxAutoRetries) => set({ maxAutoRetries }),
      incrementAutoRetry: () => set((state) => ({ autoRetryCount: state.autoRetryCount + 1 })),
      resetAutoRetry: () => set({ autoRetryCount: 0 }),

      getTaskMessages: (taskId) => (taskId ? get().messages[taskId] ?? EMPTY_MESSAGES : EMPTY_MESSAGES),
      getTaskPendingAttachments: (taskId) =>
        taskId ? get().pendingAttachments[taskId] ?? EMPTY_ATTACHMENTS : EMPTY_ATTACHMENTS,
      getTaskRunning: (taskId) => (taskId ? Boolean(get().taskRunning[taskId]) : false),
      getTaskRuns: (taskId) => {
        if (!taskId) return EMPTY_RUNS;
        const state = get();
        const ids = state.runOrderByTask[taskId] || [];
        if (ids.length === 0) return EMPTY_RUNS;
        return ids
          .slice()
          .reverse()
          .map((id) => state.runsById[id])
          .filter(Boolean);
      },
      getLatestRun: (taskId) => {
        if (!taskId) return null;
        const state = get();
        const ids = state.runOrderByTask[taskId] || [];
        if (ids.length === 0) return null;
        const lastId = ids[ids.length - 1];
        return state.runsById[lastId] || null;
      },
      getTaskRunEvents: (taskId) => {
        if (!taskId) return EMPTY_RUN_EVENTS;
        const state = get();
        const runIds = state.runOrderByTask[taskId] || [];
        if (runIds.length === 0) return EMPTY_RUN_EVENTS;
        return runIds.flatMap((runId) => state.eventsByRun[runId] || []);
      },
      getRunEvents: (runId) => (runId ? get().eventsByRun[runId] ?? EMPTY_RUN_EVENTS : EMPTY_RUN_EVENTS),
      getRunTranscript: (runId) =>
        runId ? get().transcriptByRun[runId] ?? EMPTY_TRANSCRIPT : EMPTY_TRANSCRIPT,
      getRunVerification: (runId) => (runId ? get().verificationsByRun[runId] ?? null : null),
    }),
    {
      name: "bmad-chat-storage",
      partialize: (state) => ({
        orchestrationMode: state.orchestrationMode,
        messages: state.messages,
        runsById: state.runsById,
        runOrderByTask: state.runOrderByTask,
        verificationsByRun: state.verificationsByRun,
      }),
    }
  )
);
