import { useCallback, useState } from "react";
import { useChatStore } from "../stores/chatStore";
import { useChatInputHistory } from "./useChatInputHistory";
import { useChatExecutionOrchestrator } from "./use-chat-execution-orchestrator";
import type { EngineProfile } from "../types";

export interface UseChatSessionParams {
  activeTaskId: string | null;
  activeEngineId: string;
  activeProfileId: string | null;
  activeProfile: EngineProfile | null;
  executionMode: "api" | "cli";
}

export function useChatSession({
  activeTaskId,
  activeEngineId,
  activeProfileId,
  activeProfile,
  executionMode,
}: UseChatSessionParams) {
  const isRunning = useChatStore((s) => s.getTaskRunning(activeTaskId));
  const { handleRetry: baseHandleRetry, handleCopy } = useChatInputHistory(activeTaskId, isRunning);
  const [input, setInput] = useState("");

  const handleRetry = useCallback((id: string) => {
    baseHandleRetry(id, setInput);
  }, [baseHandleRetry, setInput]);
  const {
    executionPhase,
    handleSend,
    handleStop,
    pendingAttachments,
    removePendingAttachment,
  } = useChatExecutionOrchestrator({
    activeTaskId,
    activeEngineId,
    activeProfileId,
    activeProfile,
    executionMode,
    input,
    setInput,
  });

  return {
    input,
    setInput,
    executionPhase,
    handleSend,
    handleStop,
    handleRetry,
    handleCopy,
    pendingAttachments,
    removePendingAttachment,
  };
}
