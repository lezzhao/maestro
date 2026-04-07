/**
 * Subscribes to agent://state-update events from Rust backend.
 * Keeps chatStore and appStore in sync with backend state (event-driven architecture).
 * Batches execution_output_chunk to reduce store updates during streaming.
 */
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useChatStore } from "../stores/chatStore";
import type { AgentStateEvent } from "../lib/agentStateReducer";
import { useBatchedAppender } from "./useBatchedAppender";
import { useAppStore } from "../stores/appStore";
import {
  bootstrapAgentState,
  createAgentStateUpdateApplier,
} from "./agent-state-sync-support";

export function useAgentStateSync() {
  const appendRunTranscript = useChatStore((s) => s.appendRunTranscript);
  const { appendChunk: appendTranscriptChunk, flushNow: flushTranscript } =
    useBatchedAppender<string, string>((_taskId, runId, content) => appendRunTranscript(runId, content));
  const appendToMessage = useChatStore((s) => s.appendToMessage);
  const { appendChunk: appendMessageChunk, flushNow: flushMessage } =
    useBatchedAppender<string, string>((taskId, msgId, content) => appendToMessage(taskId, msgId, content));

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let bootstrapping = true;
    const bufferedUpdates: AgentStateEvent[] = [];
    const applyUpdate = createAgentStateUpdateApplier(
      appendTranscriptChunk,
      appendMessageChunk,
    );
    const applyUpdateWithFlush = (event: AgentStateEvent) => {
      const { payload } = event;
      if (payload.type === "run_finished" || payload.type === "execution_cancelled") {
        flushTranscript();
        flushMessage();
      }
      applyUpdate(event);
    };

    const setup = async () => {
      try {
        // Subscribe first to avoid missing updates while loading initial snapshot.
        unlisten = await listen<AgentStateEvent>("agent://state-update", (e) => {
          const event = e.payload;
          if (!event || typeof event !== "object" || !event.payload) return;
          if (bootstrapping) {
            bufferedUpdates.push(event);
            return;
          }
          applyUpdateWithFlush(event);
        });

        await bootstrapAgentState();
        bootstrapping = false;

        if (bufferedUpdates.length > 0) {
          for (const payload of bufferedUpdates) {
            applyUpdateWithFlush(payload);
          }
          bufferedUpdates.length = 0;
        }

        // Global bootstrap complete
        useAppStore.getState().setBootstrapped(true);
      } catch (err) {
        console.error("[useAgentStateSync] Failed to setup listener:", err);
      }
    };

    setup();
    return () => {
      unlisten?.();
      flushTranscript();
      flushMessage();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
