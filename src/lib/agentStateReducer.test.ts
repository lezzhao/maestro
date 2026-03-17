import { describe, expect, it, vi } from "vitest";
import { applyAgentStateUpdate, toTaskViewModel, type AgentStateUpdate } from "./agentStateReducer";
import type { AppTask, ChatMessage, TaskRun, TaskViewModel } from "../types";

function mockTaskRecord(id: string, overrides?: Partial<{ profile_id: string | null }>) {
  return {
    id,
    title: `task-${id}`,
    description: "",
    engine_id: "cursor",
    current_state: "BACKLOG",
    workspace_boundary: "{}",
    profile_id: overrides?.profile_id,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function makeDeps(seedTasks: TaskViewModel[] = [], activeTaskId: string | null = null) {
  const state = {
    tasks: seedTasks,
    activeTaskId,
    transcripts: {} as Record<string, string[]>,
  };
  const createdRuns: TaskRun[] = [];
  const finishedRuns: Array<{ runId: string; status: "done" | "error" | "stopped"; error?: string | null }> = [];
  const messagesByTask: Record<string, ChatMessage[]> = {};
  const updatedTasks: Array<{ id: string; patch: Partial<AppTask> }> = [];

  return {
    state,
    createdRuns,
    finishedRuns,
    messagesByTask,
    updatedTasks,
    deps: {
      createRun: vi.fn((run: TaskRun) => createdRuns.push(run)),
      finishRun: vi.fn((runId: string, status: "done" | "error" | "stopped", error?: string | null) => {
        finishedRuns.push({ runId, status, error });
      }),
      appendRunTranscript: vi.fn((runId: string, content: string) => {
        state.transcripts[runId] = [...(state.transcripts[runId] || []), content];
      }),
      setMessages: vi.fn((taskId: string, messages: ChatMessage[]) => {
        messagesByTask[taskId] = messages;
      }),
      setTasks: vi.fn((tasks: TaskViewModel[]) => {
        state.tasks = tasks;
      }),
      updateTask: vi.fn((id: string, patch: Partial<AppTask>) => {
        updatedTasks.push({ id, patch });
      }),
      getAppState: vi.fn(() => ({ tasks: state.tasks, activeTaskId: state.activeTaskId })),
      setAppState: vi.fn((next: { tasks: TaskViewModel[]; activeTaskId: string | null }) => {
        state.tasks = next.tasks;
        state.activeTaskId = next.activeTaskId;
      }),
    },
  };
}

describe("agentStateReducer integration", () => {
  it("syncs task create and delete with active fallback", () => {
    const taskA = toTaskViewModel(mockTaskRecord("a"));
    const taskB = toTaskViewModel(mockTaskRecord("b"));
    const h = makeDeps([taskA], "a");

    applyAgentStateUpdate(
      { type: "task_created", task: mockTaskRecord("b") },
      h.deps,
    );
    expect(h.state.tasks.map((t) => t.id)).toEqual(["b", "a"]);

    applyAgentStateUpdate(
      { type: "task_deleted", task_id: "a" },
      h.deps,
    );
    expect(h.state.tasks.map((t) => t.id)).toEqual(["b"]);
    expect(h.state.activeTaskId).toBe("b");

    // Keep variable used for stronger readability in failure output.
    expect(taskB.id).toBe("b");
  });

  it("handles run lifecycle and transcript append", () => {
    const h = makeDeps();
    const updates: AgentStateUpdate[] = [
      {
        type: "run_created",
        task_id: "t1",
        run: {
          id: "run-1",
          task_id: "t1",
          engine_id: "cursor",
          mode: "cli",
          status: "running",
          created_at: Date.now(),
          started_at: Date.now(),
        },
      },
      { type: "execution_output_chunk", task_id: "t1", run_id: "run-1", chunk: "hello" },
      { type: "run_finished", task_id: "t1", run_id: "run-1", status: "done" },
    ];

    for (const u of updates) {
      applyAgentStateUpdate(u, h.deps);
    }

    expect(h.createdRuns).toHaveLength(1);
    expect(h.createdRuns[0]?.id).toBe("run-1");
    expect(h.state.transcripts["run-1"]).toEqual(["hello"]);
    expect(h.finishedRuns).toEqual([{ runId: "run-1", status: "done", error: null }]);
  });

  it("maps messages_updated payload to chat messages", () => {
    const h = makeDeps();
    applyAgentStateUpdate(
      {
        type: "messages_updated",
        task_id: "t2",
        messages: [{ id: "m1", role: "assistant", content: "ok" }],
      },
      h.deps,
    );
    expect(h.messagesByTask.t2).toHaveLength(1);
    expect(h.messagesByTask.t2[0]?.role).toBe("assistant");
    expect(h.messagesByTask.t2[0]?.content).toBe("ok");
  });

  it("maps execution_cancelled to stopped run status", () => {
    const h = makeDeps();
    applyAgentStateUpdate(
      { type: "execution_cancelled", task_id: "t3", run_id: "run-3" },
      h.deps,
    );
    expect(h.finishedRuns).toEqual([{ runId: "run-3", status: "stopped", error: null }]);
  });

  it("handles task_engine_changed by updating task engineId and clearing sessionId", () => {
    const taskA = toTaskViewModel(mockTaskRecord("a"));
    taskA.sessionId = "sess-1";
    const h = makeDeps([taskA], "a");

    applyAgentStateUpdate(
      { type: "task_engine_changed", task_id: "a", engine_id: "claude", profile_id: "test_profile" },
      h.deps,
    );

    expect(h.updatedTasks).toHaveLength(1);
    expect(h.updatedTasks[0]).toEqual({
      id: "a",
      patch: { engineId: "claude", profileId: "test_profile", sessionId: null },
    });
  });

  it("maps task_created with profile_id to TaskViewModel profileId", () => {
    const record = mockTaskRecord("p1", { profile_id: "review_profile" });
    const vm = toTaskViewModel(record);
    expect(vm.profileId).toBe("review_profile");
  });

  it("task_engine_changed updates only the target task, leaving others untouched", () => {
    const taskA = toTaskViewModel(mockTaskRecord("a"));
    taskA.sessionId = "sess-a";
    taskA.engineId = "cursor";
    const taskB = toTaskViewModel(mockTaskRecord("b"));
    taskB.sessionId = "sess-b";
    taskB.engineId = "claude";
    const h = makeDeps([taskA, taskB], "a");

    applyAgentStateUpdate(
      { type: "task_engine_changed", task_id: "a", engine_id: "gemini" },
      h.deps,
    );

    expect(h.updatedTasks).toHaveLength(1);
    expect(h.updatedTasks[0]).toEqual({
      id: "a",
      patch: { engineId: "gemini", profileId: null, sessionId: null },
    });
    expect(h.updatedTasks.some((u) => u.id === "b")).toBe(false);
  });
});
