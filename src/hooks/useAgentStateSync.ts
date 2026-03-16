/**
 * Subscribes to agent://state-update events from Rust backend.
 * Keeps chatStore in sync with backend state (event-driven architecture).
 */
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useChatStore } from "../stores/chatStore";
import type { ChatAttachment, TaskRun } from "../types";

type AgentStateUpdate =
  | { type: "run_created"; task_id: string; run: TaskRunPayload }
  | { type: "run_finished"; task_id: string; run_id: string; status: string; error?: string | null }
  | { type: "messages_updated"; task_id: string; messages: PersistedMessagePayload[] };

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

export function useAgentStateSync() {
  const createRun = useChatStore((s) => s.createRun);
  const finishRun = useChatStore((s) => s.finishRun);
  const setMessages = useChatStore((s) => s.setMessages);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setup = async () => {
      try {
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
  }, [createRun, finishRun, setMessages]);
}
