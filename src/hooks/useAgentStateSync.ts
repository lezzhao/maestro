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
import { useBatchedAppender } from "./useBatchedAppender";

export function useAgentStateSync() {
  const appendRunTranscript = useChatStore((s) => s.appendRunTranscript);
  const { appendChunk: appendTranscriptChunk, flushNow: flushTranscript } =
    useBatchedAppender<string, string>((_taskId, runId, content) => appendRunTranscript(runId, content));

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let bootstrapping = true;
    const bufferedUpdates: AgentStateUpdate[] = [];

    const applyUpdate = (payload: AgentStateUpdate) => {
      if (!payload || typeof payload !== "object") return;
      if (payload.type === "run_finished" || payload.type === "execution_cancelled") {
        flushTranscript();
      }
      const appState = useAppStore.getState();
      const chatState = useChatStore.getState();
      applyAgentStateUpdate(payload, {
        createRun: chatState.createRun,
        finishRun: chatState.finishRun,
        appendRunTranscript: (runId, content) => appendTranscriptChunk("", runId, content),
        setMessages: chatState.setMessages,
        setTasks: appState.setTasks,
        updateTaskRecord: appState.updateTaskRecord,
        setTaskResolvedRuntimeContext: appState.setTaskResolvedRuntimeContext,
        updateTaskRuntimeBinding: appState.updateTaskRuntimeBinding,
        getAppState: () => useAppStore.getState(),
        setAppState: (next) => useAppStore.setState(next),
        setEnginePreflight: appState.setEnginePreflight,
        addWorkspace: appState.addWorkspace,
        updateWorkspace: (workspace) => appState.updateWorkspace(workspace.id, workspace),
        removeWorkspace: appState.removeWorkspace,
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
        const chatMessages = useChatStore.getState().messages;
        const taskModels = tasks.map((taskRecord) => {
          const vm = toTaskViewModel(taskRecord);
          let input = 0;
          let output = 0;
          const msgs = chatMessages[vm.id];
          if (msgs) {
            for (const m of msgs) {
              if (m.tokenEstimate) {
                input += m.tokenEstimate.approx_input_tokens || 0;
                output += m.tokenEstimate.approx_output_tokens || 0;
              }
            }
          }
          vm.stats.approx_input_tokens = input;
          vm.stats.approx_output_tokens = output;
          return vm;
        });
        useAppStore.getState().setTasks(taskModels);
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
