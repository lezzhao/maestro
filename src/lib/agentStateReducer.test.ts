import { describe, expect, it, vi } from "vitest";
import { applyAgentStateUpdate, toTaskViewModel, type AgentStateEvent } from "./agentStateReducer";
import type { ChatMessage, TaskRecord, TaskRun, TaskViewModel } from "../types";

function mockTaskRecord(id: string, overrides?: Partial<TaskRecord>) {
  return {
    id,
    title: `task-${id}`,
    description: "",
    engine_id: "cursor",
    current_state: "BACKLOG",
    workspace_boundary: "{}",
    profile_id: null,
    workspace_id: null,
    settings: null,
    created_at: Date.now(),
    updated_at: Date.now(),
    ...overrides,
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
  const updatedTaskRecords: Array<{ id: string; patch: Partial<import("../types").TaskViewState> }> = [];

  return {
    state,
    createdRuns,
    finishedRuns,
    messagesByTask,
    updatedTaskRecords,
    deps: {
      createRun: vi.fn((run: TaskRun) => createdRuns.push(run)),
      finishRun: vi.fn((runId: string, status: "done" | "error" | "stopped", error?: string | null) => {
        finishedRuns.push({ runId, status, error });
      }),
      appendRunTranscript: vi.fn((runId: string, content: string) => {
        state.transcripts[runId] = [...(state.transcripts[runId] || []), content];
      }),
      addMessage: vi.fn((taskId: string, message: ChatMessage) => {
        messagesByTask[taskId] = [...(messagesByTask[taskId] || []), message];
      }),
      setMessages: vi.fn((taskId: string, messages: ChatMessage[]) => {
        messagesByTask[taskId] = messages;
      }),
      setTasks: vi.fn((tasks: TaskViewModel[]) => {
        state.tasks = tasks;
      }),
      updateTaskRecord: vi.fn((id: string, patch: Partial<import("../types").TaskViewState>) => {
        updatedTaskRecords.push({ id, patch });
        state.tasks = state.tasks.map((task) =>
          task.id === id ? { ...task, ...patch } : task,
        );
      }),
      updateTaskRuntimeBinding: vi.fn(),
      setTaskResolvedRuntimeContext: vi.fn(),
      getAppState: vi.fn(() => ({ tasks: state.tasks, activeTaskId: state.activeTaskId })),
      setAppState: vi.fn((next: { tasks: TaskViewModel[]; activeTaskId: string | null }) => {
        state.tasks = next.tasks;
        state.activeTaskId = next.activeTaskId;
      }),
      setEnginePreflight: vi.fn(),
      addWorkspace: vi.fn(),
      updateWorkspace: vi.fn(),
      removeWorkspace: vi.fn(),
      updateMessage: vi.fn(),
      resolveChoice: vi.fn(),
      appendToMessage: vi.fn(),
      setActiveRunId: vi.fn(),
      setActiveAssistantMsgId: vi.fn(),
      getChatState: vi.fn(() => ({
        taskActiveRunId: {},
        taskActiveAssistantMsgId: {},
      })),
      setTaskRunning: vi.fn(),
      setExecutionPhase: vi.fn(),
      setPendingPermissionRequest: vi.fn(),
      getTaskStateToken: vi.fn(() => undefined),
    },
  };
}

describe("agentStateReducer integration", () => {
  it("syncs task create and delete with active fallback", () => {
    const taskA = toTaskViewModel(mockTaskRecord("a"));
    const taskB = toTaskViewModel(mockTaskRecord("b"));
    const h = makeDeps([taskA], "a");

    applyAgentStateUpdate(
      { payload: { type: "task_created", task: mockTaskRecord("b") } },
      h.deps,
    );
    expect(h.state.tasks.map((t) => t.id)).toEqual(["b", "a"]);

    applyAgentStateUpdate(
      { payload: { type: "task_deleted", task_id: "a" } },
      h.deps,
    );
    expect(h.state.tasks.map((t) => t.id)).toEqual(["b"]);
    expect(h.state.activeTaskId).toBe("b");

    // Keep variable used for stronger readability in failure output.
    expect(taskB.id).toBe("b");
  });

  it("handles run lifecycle and transcript append", () => {
    const h = makeDeps();
    const updates: AgentStateEvent[] = [
      {
        payload: {
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
        }
      },
      { payload: { type: "execution_output_chunk", task_id: "t1", run_id: "run-1", chunk: "hello" } },
      { payload: { type: "run_finished", task_id: "t1", run_id: "run-1", status: "done" } },
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
        payload: {
          type: "messages_updated",
          task_id: "t2",
          messages: [
            {
              id: "m1",
              role: "assistant",
              content: "ok",
              meta: {
                choice: {
                  title: "需要选择",
                  description: "请选择下一步操作",
                  status: "pending",
                  options: [
                    {
                      id: "open-settings",
                      label: "打开设置",
                      action: { kind: "open_settings" },
                    },
                  ],
                },
              },
            },
          ],
        }
      },
      h.deps,
    );
    expect(h.messagesByTask.t2).toHaveLength(1);
    expect(h.messagesByTask.t2[0]?.role).toBe("assistant");
    expect(h.messagesByTask.t2[0]?.content).toBe("ok");
    expect(h.messagesByTask.t2[0]?.meta?.choice?.title).toBe("需要选择");
  });

  it("maps execution_cancelled to stopped run status", () => {
    const h = makeDeps();
    applyAgentStateUpdate(
      { payload: { type: "execution_cancelled", task_id: "t3", run_id: "run-3" } },
      h.deps,
    );
    expect(h.finishedRuns).toEqual([{ runId: "run-3", status: "stopped", error: null }]);
  });

  it("appends message_appended payload to chat messages", () => {
    const h = makeDeps();
    applyAgentStateUpdate(
      {
        payload: {
          type: "message_appended",
          task_id: "t4",
          message: {
            id: "m-choice",
            role: "system",
            content: "需要操作",
            meta: {
              choice: {
                title: "修复 CLI 问题",
                status: "pending",
                options: [
                  {
                    id: "open-settings",
                    label: "打开设置",
                    action: { kind: "open_settings" },
                  },
                ],
              },
            },
          },
        }
      },
      h.deps,
    );
    expect(h.messagesByTask.t4).toHaveLength(1);
    expect(h.messagesByTask.t4[0]?.meta?.choice?.title).toBe("修复 CLI 问题");
  });

  it("resolves choice_resolved payload via resolveChoice", () => {
    const h = makeDeps();

    applyAgentStateUpdate(
      {
        payload: {
          type: "choice_resolved",
          task_id: "t5",
          message_id: "m-resolve",
          option_id: "open-settings",
        }
      },
      h.deps,
    );

    expect(h.deps.resolveChoice).toHaveBeenCalledWith("t5", "m-resolve", "open-settings");
  });

  it("handles task_runtime_binding_changed by updating task engineId, profileId, runtimeSnapshotId", () => {
    const taskA = toTaskViewModel(mockTaskRecord("a"));
    taskA.sessionId = "sess-1";
    const h = makeDeps([taskA], "a");

    applyAgentStateUpdate(
      {
        payload: {
          type: "task_runtime_binding_changed",
          task_id: "a",
          binding: {
            engineId: "claude",
            profileId: "test_profile",
            runtimeSnapshotId: "snap-1",
            sessionId: null,
          },
        }
      },
      h.deps,
    );

    expect(h.deps.updateTaskRuntimeBinding).toHaveBeenCalledWith("a", {
      engineId: "claude",
      profileId: "test_profile",
      runtimeSnapshotId: "snap-1",
      sessionId: null,
    });
  });

  it("maps task_created with profile_id to TaskViewModel profileId", () => {
    const record = mockTaskRecord("p1", { profile_id: "review_profile" });
    const vm = toTaskViewModel(record);
    expect(vm.profileId).toBe("review_profile");
  });

  it("maps task_created with settings to TaskViewModel settings", () => {
    const record = mockTaskRecord("p1", { settings: "{\"mode\":\"review\"}" });
    const vm = toTaskViewModel(record);
    expect(vm.settings).toBe("{\"mode\":\"review\"}");
  });

  it("updates existing task when receiving task_updated while preserving runtime fields", () => {
    const taskA = toTaskViewModel(mockTaskRecord("a"));
    taskA.sessionId = "sess-a";
    taskA.activeExecId = "exec-a";
    taskA.activeRunId = "run-a";
    taskA.stats.approx_input_tokens = 42;
    const h = makeDeps([taskA], "a");

    applyAgentStateUpdate(
      {
        payload: {
          type: "task_updated",
          task: {
            ...mockTaskRecord("a"),
            title: "task-a-updated",
            current_state: "DONE",
            settings: "{\"mode\":\"review\"}",
          },
        }
      },
      h.deps,
    );

    expect(h.state.tasks).toHaveLength(1);
    expect(h.state.tasks[0]?.name).toBe("task-a-updated");
    expect(h.state.tasks[0]?.status).toBe("completed");
    expect(h.state.tasks[0]?.settings).toBe("{\"mode\":\"review\"}");
    expect(h.state.tasks[0]?.sessionId).toBe("sess-a");
    expect(h.state.tasks[0]?.activeExecId).toBe("exec-a");
    expect(h.state.tasks[0]?.activeRunId).toBe("run-a");
    expect(h.state.tasks[0]?.stats.approx_input_tokens).toBe(42);
    expect(h.deps.setTasks).not.toHaveBeenCalled();
  });

  it("handles task_state_changed by calling updateTaskRecord with status", () => {
    const taskA = toTaskViewModel(mockTaskRecord("a"));
    const h = makeDeps([taskA], "a");

    applyAgentStateUpdate(
      {
        payload: {
          type: "task_state_changed",
          task_id: "a",
          from_state: "BACKLOG",
          to_state: "IN_PROGRESS",
        }
      },
      h.deps,
    );

    expect(h.deps.updateTaskRecord).toHaveBeenCalledWith("a", expect.objectContaining({
      status: "running",
    }));
  });

  it("task_runtime_binding_changed updates only the target task via updateTaskRuntimeBinding", () => {
    const taskA = toTaskViewModel(mockTaskRecord("a"));
    taskA.sessionId = "sess-a";
    taskA.engineId = "cursor";
    const taskB = toTaskViewModel(mockTaskRecord("b"));
    taskB.sessionId = "sess-b";
    taskB.engineId = "claude";
    const h = makeDeps([taskA, taskB], "a");

    applyAgentStateUpdate(
      {
        payload: {
          type: "task_runtime_binding_changed",
          task_id: "a",
          binding: {
            engineId: "gemini",
            profileId: null,
            runtimeSnapshotId: null,
            sessionId: null,
          },
        }
      },
      h.deps,
    );

    expect(h.deps.updateTaskRuntimeBinding).toHaveBeenCalledWith("a", {
      engineId: "gemini",
      profileId: null,
      runtimeSnapshotId: null,
      sessionId: null,
    });
  });
});
