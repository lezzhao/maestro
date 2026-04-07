import { TaskRun, TaskRunStatus, RunEvent, RunArtifact, VerificationSummary } from "../../types";
import { ChatStore, MAX_RUN_EVENTS, MAX_ARTIFACTS, MAX_TRANSCRIPT_LENGTH, EMPTY_RUNS, EMPTY_RUN_EVENTS, EMPTY_TRANSCRIPT } from "./types";

export const createRunActions = (
  set: (fn: (state: ChatStore) => Partial<ChatStore>) => void,
  get: () => ChatStore
) => ({
  setActiveRunId: (taskId: string, runId: string | null) =>
    set((state: ChatStore) => ({
      taskActiveRunId: { ...state.taskActiveRunId, [taskId]: runId },
    })),
  setActiveAssistantMsgId: (taskId: string, messageId: string | null) =>
    set((state: ChatStore) => ({
      taskActiveAssistantMsgId: { ...state.taskActiveAssistantMsgId, [taskId]: messageId },
    })),
  setExecutionPhase: (taskId: string, phase: "idle" | "connecting" | "sending" | "streaming" | "completed" | "error") =>
    set((state: ChatStore) => ({
      taskExecutionPhase: { ...state.taskExecutionPhase, [taskId]: phase },
    })),

  setTaskRunning: (taskId: string, running: boolean) =>
    set((state: ChatStore) => ({
      taskRunning: {
        ...state.taskRunning,
        [taskId]: running,
      },
    })),
  createRun: (run: TaskRun) =>
    set((state: ChatStore) => {
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
  updateRun: (runId: string, patch: Partial<TaskRun>) =>
    set((state: ChatStore) => {
      const run = state.runsById[runId];
      if (!run) return state;
      return {
        runsById: {
          ...state.runsById,
          [runId]: { ...run, ...patch },
        },
      };
    }),
  finishRun: (runId: string, status: TaskRunStatus, error?: string | null) =>
    set((state: ChatStore) => {
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
  addRunEvent: (runId: string, event: RunEvent) =>
    set((state: ChatStore) => {
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
  appendRunTranscript: (runId: string, content: string) =>
    set((state: ChatStore) => {
      const current = state.transcriptByRun[runId] || "";
      const next = (current + content).slice(-MAX_TRANSCRIPT_LENGTH);
      return {
        transcriptByRun: {
          ...state.transcriptByRun,
          [runId]: next,
        },
      };
    }),
  addRunArtifact: (runId: string, artifact: RunArtifact) =>
    set((state: ChatStore) => {
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
  setRunVerification: (runId: string, verification: VerificationSummary | null) =>
    set((state: ChatStore) => ({
      verificationsByRun: {
        ...state.verificationsByRun,
        [runId]: verification,
      },
    })),
  clearTaskRuns: (taskId: string) =>
    set((state: ChatStore) => {
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
  clearRunEvents: (taskId: string) =>
    set((state: ChatStore) => ({
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
  setActiveSessionId: (activeSessionId: string | null) => set(() => ({ activeSessionId })),
  setOrchestrationMode: (orchestrationMode: "direct" | "auto") => set(() => ({ orchestrationMode })),
  setMaxAutoRetries: (maxAutoRetries: number) => set(() => ({ maxAutoRetries })),
  incrementAutoRetry: () => set((state: ChatStore) => ({ autoRetryCount: state.autoRetryCount + 1 })),
  resetAutoRetry: () => set(() => ({ autoRetryCount: 0 })),
  setTaskStateToken: (taskId: string, token: string) =>
    set((state: ChatStore) => ({
      taskStateToken: { ...state.taskStateToken, [taskId]: token },
    })),

  getTaskRuns: (taskId: string | null) => {
    if (!taskId) return EMPTY_RUNS;
    const state = get();
    const ids = state.runOrderByTask[taskId] || [];
    if (ids.length === 0) return EMPTY_RUNS;
    return ids
      .slice()
      .reverse()
      .map((id: string) => state.runsById[id])
      .filter(Boolean);
  },
  getLatestRun: (taskId: string | null) => {
    if (!taskId) return null;
    const state = get();
    const ids = state.runOrderByTask[taskId] || [];
    if (ids.length === 0) return null;
    const lastId = ids[ids.length - 1];
    return state.runsById[lastId] || null;
  },
  getTaskRunEvents: (taskId: string | null) => {
    if (!taskId) return EMPTY_RUN_EVENTS;
    const state = get();
    const runIds = state.runOrderByTask[taskId] || [];
    if (runIds.length === 0) return EMPTY_RUN_EVENTS;
    return runIds.flatMap((runId: string) => state.eventsByRun[runId] || []);
  },
  getRunEvents: (runId: string | null) => (runId ? get().eventsByRun[runId] ?? EMPTY_RUN_EVENTS : EMPTY_RUN_EVENTS),
  getRunTranscript: (runId: string | null) =>
    runId ? get().transcriptByRun[runId] ?? EMPTY_TRANSCRIPT : EMPTY_TRANSCRIPT,
  getRunVerification: (runId: string | null) => (runId ? get().verificationsByRun[runId] ?? null : null),
});
