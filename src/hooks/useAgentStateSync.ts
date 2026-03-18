/**
 * Subscribes to agent://state-update events from Rust backend.
 * Keeps chatStore and appStore in sync with backend state (event-driven architecture).
 * Batches execution_output_chunk to reduce store updates during streaming.
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
import { useBatchedTranscript } from "./useBatchedTranscript";

export function useAgentStateSync() {
  const createRun = useChatStore((s) => s.createRun);
  const finishRun = useChatStore((s) => s.finishRun);
  const appendRunTranscript = useChatStore((s) => s.appendRunTranscript);
  const { appendChunk: appendTranscriptChunk, flushNow: flushTranscript } =
    useBatchedTranscript(appendRunTranscript);
  const setMessages = useChatStore((s) => s.setMessages);
  const setTasks = useAppStore((s) => s.setTasks);
  const updateTaskRecord = useAppStore((s) => s.updateTaskRecord);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let bootstrapping = true;
    const bufferedUpdates: AgentStateUpdate[] = [];

    const applyUpdate = (payload: AgentStateUpdate) => {
      if (!payload || typeof payload !== "object") return;
      if (payload.type === "run_finished" || payload.type === "execution_cancelled") {
        flushTranscript();
      }
      applyAgentStateUpdate(payload, {
        createRun,
        finishRun,
        appendRunTranscript: appendTranscriptChunk,
        setMessages,
        setTasks,
        updateTaskRecord,
        setTaskResolvedRuntimeContext: useAppStore.getState().setTaskResolvedRuntimeContext,
        updateTaskRuntimeBinding: useAppStore.getState().updateTaskRuntimeBinding,
        getAppState: () => useAppStore.getState(),
        setAppState: (next) => useAppStore.setState(next),
        setEnginePreflight: useAppStore.getState().setEnginePreflight,
        addWorkspace: useAppStore.getState().addWorkspace,
        updateWorkspace: (workspace) => useAppStore.getState().updateWorkspace(workspace.id, workspace),
        removeWorkspace: useAppStore.getState().removeWorkspace,
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

        // Load initial state from backend (authoritative source)
        const [tasks, workspaces] = await Promise.all([
          invoke<TaskRecord[]>("task_list"),
          invoke<import("../types").Workspace[]>("workspace_list"),
        ]);
        setTasks(tasks.map(toTaskViewModel));
        useAppStore.getState().setWorkspaces(workspaces);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
