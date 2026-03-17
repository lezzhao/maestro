/**
 * Subscribes to agent://state-update events from Rust backend.
 * Keeps chatStore and appStore in sync with backend state (event-driven architecture).
 */
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useAppStore } from "../stores/appStore";
import { useChatStore } from "../stores/chatStore";
import type { TaskRecord } from "../types";
import {
  applyAgentStateUpdate,
  type AgentStateUpdate,
  toTaskViewModel,
} from "../lib/agentStateReducer";

export function useAgentStateSync() {
  const createRun = useChatStore((s) => s.createRun);
  const finishRun = useChatStore((s) => s.finishRun);
  const appendRunTranscript = useChatStore((s) => s.appendRunTranscript);
  const setMessages = useChatStore((s) => s.setMessages);
  const setTasks = useAppStore((s) => s.setTasks);
  const updateTask = useAppStore((s) => s.updateTask);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let bootstrapping = true;
    const bufferedUpdates: AgentStateUpdate[] = [];

    const applyUpdate = (payload: AgentStateUpdate) => {
      if (!payload || typeof payload !== "object") return;
      applyAgentStateUpdate(payload, {
        createRun,
        finishRun,
        appendRunTranscript,
        setMessages,
        setTasks,
        updateTask,
        setTaskResolvedRuntimeContext: useAppStore.getState().setTaskResolvedRuntimeContext,
        updateTaskRuntimeBinding: useAppStore.getState().updateTaskRuntimeBinding,
        getAppState: () => useAppStore.getState(),
        setAppState: (next) => useAppStore.setState(next),
      });
    };

    const setup = async () => {
      try {
        // Subscribe first to avoid missing updates while loading initial snapshot.
        unlisten = await listen<AgentStateUpdate>("agent://state-update", (event) => {
          const payload = event.payload;
          if (!payload || typeof payload !== "object") return;
          if (bootstrapping) {
            bufferedUpdates.push(payload);
            return;
          }
          applyUpdate(payload);
        });

        // Load initial task list from backend (authoritative source)
        const tasks = await invoke<TaskRecord[]>("task_list");
        setTasks(tasks.map(toTaskViewModel));
        bootstrapping = false;

        if (bufferedUpdates.length > 0) {
          for (const payload of bufferedUpdates) {
            applyUpdate(payload);
          }
          bufferedUpdates.length = 0;
        }
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
