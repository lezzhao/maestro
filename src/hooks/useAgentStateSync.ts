/**
 * Subscribes to agent://state-update events from Rust backend.
 * Keeps chatStore and appStore in sync with backend state (event-driven architecture).
 */
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useAppStore } from "../stores/appStore";
import { useChatStore } from "../stores/chatStore";
import type { AppTask, ChatAttachment, TaskRun } from "../types";

type AgentStateUpdate =
  | { type: "run_created"; task_id: string; run: TaskRunPayload }
  | { type: "run_finished"; task_id: string; run_id: string; status: string; error?: string | null }
  | { type: "messages_updated"; task_id: string; messages: PersistedMessagePayload[] }
  | { type: "task_created"; task: TaskRecordPayload }
  | { type: "task_state_changed"; task_id: string; from_state: string; to_state: string }
  | { type: "task_deleted"; task_id: string }
  | { type: "execution_started"; task_id: string; run_id: string; mode: string }
  | { type: "execution_cancelled"; task_id: string; run_id: string }
  | { type: "execution_output_chunk"; task_id: string; run_id: string; chunk: string };

type TaskRecordPayload = {
  id: string;
  title: string;
  description: string;
  current_state: string;
  workspace_boundary: string;
  created_at: string;
  updated_at: string;
};

type TaskRunPayload = {
  id: string;
  task_id: string;
  engine_id: string;
  mode: string;
  status: string;
  created_at: number;
  started_at: number;
  ended_at?: number | null;
  error?: string | null;
};

type PersistedMessagePayload = {
  id: string;
  role: string;
  content: string;
};

function toTaskRun(p: TaskRunPayload): TaskRun {
  return {
    id: p.id,
    taskId: p.task_id,
    engineId: p.engine_id,
    mode: p.mode as "api" | "cli",
    status: p.status as TaskRun["status"],
    createdAt: p.created_at,
    startedAt: p.started_at,
    endedAt: p.ended_at ?? undefined,
    error: p.error ?? undefined,
  };
}

function mapTaskStateToStatus(
  currentState: string
): AppTask["status"] {
  switch (currentState) {
    case "PLANNING":
    case "IN_PROGRESS":
      return "running";
    case "CODE_REVIEW":
      return "needs_review";
    case "DONE":
      return "completed";
    default:
      return "idle";
  }
}

function toAppTask(p: TaskRecordPayload): AppTask {
  const created = p.created_at ? new Date(p.created_at).getTime() : Date.now();
  const updated = p.updated_at ? new Date(p.updated_at).getTime() : Date.now();
  return {
    id: p.id,
    name: p.title,
    sessionId: null,
    activeExecId: null,
    activeRunId: null,
    status: mapTaskStateToStatus(p.current_state),
    gitChanges: [],
    stats: {
      cpu_percent: 0,
      memory_mb: 0,
      approx_input_tokens: 0,
      approx_output_tokens: 0,
    },
    created_at: created,
    updated_at: updated,
  };
}

export function useAgentStateSync() {
  const createRun = useChatStore((s) => s.createRun);
  const finishRun = useChatStore((s) => s.finishRun);
  const appendRunTranscript = useChatStore((s) => s.appendRunTranscript);
  const setMessages = useChatStore((s) => s.setMessages);
  const setTasks = useAppStore((s) => s.setTasks);
  const updateTask = useAppStore((s) => s.updateTask);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setup = async () => {
      try {
        // Load initial task list from backend (authoritative source)
        const loadTasks = async () => {
          try {
            const tasks = await invoke<TaskRecordPayload[]>("task_list");
            setTasks(tasks.map(toAppTask));
          } catch (err) {
            console.error("[useAgentStateSync] Failed to load tasks:", err);
          }
        };
        await loadTasks();

        unlisten = await listen<AgentStateUpdate>("agent://state-update", (event) => {
          const payload = event.payload;
          if (!payload || typeof payload !== "object") return;

          switch (payload.type) {
            case "run_created": {
              const run = toTaskRun(payload.run);
              createRun(run);
              break;
            }
            case "run_finished": {
              const status = payload.status === "done" ? "done" : "error";
              finishRun(payload.run_id, status, payload.error ?? null);
              break;
            }
            case "messages_updated": {
              const messages = payload.messages.map((m) => ({
                id: m.id,
                role: m.role as "user" | "assistant" | "system" | "plan",
                content: m.content,
                timestamp: Date.now(),
                attachments: [] as ChatAttachment[],
                status: "done" as const,
              }));
              setMessages(payload.task_id, messages);
              break;
            }
            case "task_created": {
              const existing = useAppStore.getState().tasks;
              if (!existing.some((t) => t.id === payload.task.id)) {
                setTasks([toAppTask(payload.task), ...existing]);
              }
              break;
            }
            case "task_state_changed": {
              updateTask(payload.task_id, {
                status: mapTaskStateToStatus(payload.to_state),
                updated_at: Date.now(),
              });
              break;
            }
            case "task_deleted": {
              const current = useAppStore.getState();
              const remaining = current.tasks.filter((t) => t.id !== payload.task_id);
              useAppStore.setState({
                tasks: remaining,
                activeTaskId:
                  current.activeTaskId === payload.task_id
                    ? (remaining[0]?.id ?? null)
                    : current.activeTaskId,
              });
              break;
            }
            case "execution_cancelled": {
              finishRun(payload.run_id, "stopped", null);
              break;
            }
            case "execution_output_chunk": {
              appendRunTranscript(payload.run_id, payload.chunk);
              break;
            }
            case "execution_started":
              // Handled by run_created; no-op if duplicate
              break;
            default:
              break;
          }
        });
      } catch (err) {
        console.error("[useAgentStateSync] Failed to setup listener:", err);
      }
    };

    setup();
    return () => {
      unlisten?.();
    };
  }, [createRun, finishRun, appendRunTranscript, setMessages, setTasks, updateTask]);
}
