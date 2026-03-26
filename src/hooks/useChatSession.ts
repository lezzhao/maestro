import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useChatStore } from "../stores/chatStore";
import { useChatAgent } from "./useChatAgent";
import { useAppStore } from "../stores/appStore";
import { useTranslation } from "../i18n";
import { createMessage } from "../components/chat/createMessage";
import { useExecutionQueue } from "./useExecutionQueue";
import { useChatInputHistory } from "./useChatInputHistory";
import { useAgentExecutor } from "./useAgentExecutor";
import { useBatchedAppender } from "./useBatchedAppender";
import type { ExecutionEvent } from "../services/ExecutionClient";
import type { ChatApiMessage, EngineProfile, RunEvent } from "../types";

import { toast } from "sonner";

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
  const { t } = useTranslation();
  const updateTaskRecord = useAppStore((s) => s.updateTaskRecord);
  const updateTaskRuntimeBinding = useAppStore((s) => s.updateTaskRuntimeBinding);

  const isRunning = useChatStore((s) => s.getTaskRunning(activeTaskId));
  const pendingAttachments = useChatStore((s) => s.getTaskPendingAttachments(activeTaskId));
  const addMessage = useChatStore((s) => s.addMessage);
  const updateMessage = useChatStore((s) => s.updateMessage);
  const appendToMessage = useChatStore((s) => s.appendToMessage);
  const setRunning = useChatStore((s) => s.setRunning);
  const setTaskRunning = useChatStore((s) => s.setTaskRunning);
  const createRun = useChatStore((s) => s.createRun);
  const finishRun = useChatStore((s) => s.finishRun);
  const updateRun = useChatStore((s) => s.updateRun);
  const addRunEvent = useChatStore((s) => s.addRunEvent);
  const appendRunTranscript = useChatStore((s) => s.appendRunTranscript);
  
  const { appendChunk: appendTranscriptChunk, flushNow: flushTranscript } =
    useBatchedAppender<string, string>((_taskId, runId, content) => appendRunTranscript(runId, content));
    
  const { appendChunk: appendMessageChunk, flushNow: flushMessage } =
    useBatchedAppender<string, string>((taskId, msgId, content) => appendToMessage(taskId, msgId, content));

  const addRunArtifact = useChatStore((s) => s.addRunArtifact);
  const setRunVerification = useChatStore((s) => s.setRunVerification);
  const clearPendingAttachmentsByTask = useChatStore((s) => s.clearPendingAttachments);
  const removePendingAttachmentByTask = useChatStore((s) => s.removePendingAttachment);

  const { stopSession, saveLastConversation } = useChatAgent();
  const { queue, pushQueue, popQueue, clearQueue } = useExecutionQueue();
  const { handleRetry: baseHandleRetry, handleCopy } = useChatInputHistory(activeTaskId, isRunning);

  const [input, setInput] = useState("");
  const executionPhase = useChatStore((s) => s.taskExecutionPhase[activeTaskId ?? ""] || "idle");
  const setExecutionPhase = useChatStore((s) => s.setExecutionPhase);
  const activeRunId = useChatStore((s) => s.taskActiveRunId[activeTaskId ?? ""]);
  const activeAssistantMsgId = useChatStore((s) => s.taskActiveAssistantMsgId[activeTaskId ?? ""]);
  const setActiveRunId = useChatStore((s) => s.setActiveRunId);
  const setActiveAssistantMsgId = useChatStore((s) => s.setActiveAssistantMsgId);

  const runExecutionRef = useRef<
    ((content: string, mode: "api" | "cli") => Promise<void>) | null
  >(null);

  const cliContinuationRef = useRef(false);

  // --- Orchestrator for Queue & Execution Phase Transitions ---
  useEffect(() => {
    if (activeTaskId && (executionPhase === "completed" || executionPhase === "error")) {
      const timer = setTimeout(() => setExecutionPhase(activeTaskId, "idle"), 600);
      return () => clearTimeout(timer);
    }
  }, [activeTaskId, executionPhase, setExecutionPhase]);

  const emitRunEvent = useCallback(
    (patch: Omit<RunEvent, "id" | "taskId" | "createdAt" | "runId">) => {
      if (!activeTaskId || !activeRunId) return;
      const event: RunEvent = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        taskId: activeTaskId,
        runId: activeRunId,
        createdAt: Date.now(),
        ...patch,
      };
      addRunEvent(activeRunId, event);
    },
    [activeTaskId, activeRunId, addRunEvent],
  );

  useEffect(() => {
    if (activeTaskId && executionPhase === "idle" && !isRunning && queue.length > 0) {
      const next = popQueue();
      if (next) {
        setExecutionPhase(activeTaskId, "connecting");
        setTimeout(() => {
          void runExecutionRef.current?.(next.content, next.mode);
        }, 50);
      }
    }
  }, [activeTaskId, executionPhase, isRunning, queue.length, popQueue, setExecutionPhase]);

  const handleRetry = useCallback((id: string) => {
    baseHandleRetry(id, setInput);
  }, [baseHandleRetry, setInput]);

  const finalizeRound = useCallback(() => {
    if (!activeTaskId) return;
    
    // Status and store clearing are now handled by AgentStateSync event reactor
    const verification = activeRunId
      ? useChatStore.getState().getRunVerification(activeRunId)
      : null;
    const nextStatus =
      verification?.has_verification && verification.test_run?.success
        ? "verified"
        : verification?.has_verification
          ? "needs_review"
          : "completed";
          
    updateTaskRecord(activeTaskId, { status: nextStatus });

    emitRunEvent({
      kind: "status",
      status: "done",
      message: "本轮执行完成",
      engineId: activeEngineId,
      mode: executionMode,
    });

    cliContinuationRef.current = executionMode === "cli";
  }, [
    activeEngineId,
    activeTaskId,
    activeRunId,
    emitRunEvent,
    executionMode,
    updateTaskRecord,
  ]);

  const failRound = useCallback(
    (errText: string) => {
      if (!activeTaskId) return;
      
      if (errText.includes("Workspace Trust Required")) {
        toast.warning("Workspace Trust Required", {
          description: "Cursor Agent requires directory trust. Please run 'cursor agent' in your terminal once.",
          duration: 6000,
          action: {
            label: "How to fix",
            onClick: () => window.open("https://docs.cursor.com/agent/trust", "_blank")
          }
        });
      } else {
        toast.error(`${t("execution_error")}: ${errText}`);
      }
      updateTaskRecord(activeTaskId, { status: "error" });

      emitRunEvent({
        kind: "error",
        status: "error",
        message: errText,
        engineId: activeEngineId,
        mode: executionMode,
      });

      cliContinuationRef.current = false;
    },
    [
      activeEngineId,
      activeTaskId,
      emitRunEvent,
      executionMode,
      updateTaskRecord,
      t,
    ],
  );

  const handleExecutionEvent = useCallback(
    (event: ExecutionEvent) => {
      if (!activeTaskId) return;

      switch (event.type) {
        case "verification":
          if (activeRunId) {
            setRunVerification(activeRunId, event.verification);
          }
          break;
        case "done":
          if (event.exitCode !== undefined && event.exitCode !== 0 && event.exitCode !== null) {
            failRound(`命令执行失败（退出码：${event.exitCode}）`);
          } else {
            finalizeRound();
          }
          break;
        case "error":
          failRound(event.message);
          break;
        // Text, runId, tokenUsage are handled via useAgentStateSync
      }
    },
    [
      activeTaskId,
      activeRunId,
      failRound,
      finalizeRound,
      setRunVerification,
    ],
  );

  const { startExecution, stopExecution } = useAgentExecutor(executionMode, handleExecutionEvent);

  const buildApiMessages = useCallback((): ChatApiMessage[] => {
    if (!activeTaskId) return [];
    const list = useChatStore.getState().messages[activeTaskId] || [];
    return list
      .filter(
        (m) =>
          (m.role === "system" || m.role === "user" || m.role === "assistant") &&
          !!m.content.trim(),
      )
      .map((m) => ({
        role: m.role === "system" ? "system" : m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      }));
  }, [activeTaskId]);

  const buildApiMessageIds = useCallback((): string[] => {
    if (!activeTaskId) return [];
    const list = useChatStore.getState().messages[activeTaskId] || [];
    return list
      .filter(
        (m) =>
          (m.role === "system" || m.role === "user" || m.role === "assistant") &&
          !!m.content.trim(),
      )
      .map((m) => m.id);
  }, [activeTaskId]);

  const runExecution = useCallback(
    async (content: string, mode: "api" | "cli") => {
      if (!activeTaskId) return;
      setRunning(true);
      setTaskRunning(activeTaskId, true);
      setExecutionPhase(activeTaskId, "connecting");
      updateTaskRecord(activeTaskId, { status: "running" });

      const assistantMsg = createMessage("assistant", "", {
        status: "streaming",
        meta: { engineId: activeEngineId, profileId: activeProfile?.id },
      });
      addMessage(activeTaskId, assistantMsg);
      setActiveAssistantMsgId(activeTaskId, assistantMsg.id);

      try {
        setExecutionPhase(activeTaskId, "sending");
        if (mode === "api" && activeTaskId) {
          const allMessages = useChatStore.getState().messages[activeTaskId] || [];
          await saveLastConversation({
            task_id: activeTaskId,
            messages: allMessages,
            saved_at: Date.now(),
          });
        }
        const profileId = activeProfileId;
        const request = mode === "api"
          ? {
              engine_id: activeEngineId,
              profile_id: profileId,
              task_id: activeTaskId,
              message_ids: buildApiMessageIds(),
              messages: buildApiMessages(),
              max_input_tokens: 12000,
              max_messages: 48,
            }
          : {
              engine_id: activeEngineId,
              profile_id: profileId,
              task_id: activeTaskId,
              prompt: content,
              is_continuation: cliContinuationRef.current,
            };

        const result = await startExecution(request);
        const runId = result.run_id || `run-pending-${Date.now()}`;
        setActiveRunId(activeTaskId, runId);

        updateTaskRuntimeBinding(activeTaskId, { activeExecId: result.exec_id, activeRunId: runId });
      } catch (err) {
        failRound(String(err));
      }
    },
    [
      activeEngineId,
      activeProfile?.id,
      activeProfileId,
      activeTaskId,
      addMessage,
      buildApiMessageIds,
      buildApiMessages,
      saveLastConversation,
      setRunning,
      setTaskRunning,
      setActiveAssistantMsgId,
      setActiveRunId,
      setExecutionPhase,
      startExecution,
      updateTaskRecord,
      updateTaskRuntimeBinding,
      failRound,
    ],
  );

  runExecutionRef.current = runExecution;

  useEffect(() => {
    cliContinuationRef.current = false;
  }, [activeEngineId, activeTaskId, executionMode]);

  const handleSend = async () => {
    if (!activeTaskId) return;
    const trimmedInput = input.trim();
    if (!trimmedInput && pendingAttachments.length === 0) return;

    let finalContent = trimmedInput;
    const currentAttachments = [...pendingAttachments];
    if (currentAttachments.length > 0) {
      const attachmentNotes = currentAttachments.map((a) => `[File: ${a.path}]`).join("\n");
      finalContent = `${attachmentNotes}\n\n${trimmedInput}`;
    }

    setInput("");
    clearPendingAttachmentsByTask(activeTaskId);
    addMessage(activeTaskId, createMessage("user", trimmedInput, { attachments: currentAttachments }));

    if (isRunning) {
      pushQueue({ content: finalContent, mode: executionMode });
      addMessage(
        activeTaskId,
        createMessage("system", t("queued_hint"), {
          meta: { eventType: "notice", eventStatus: "pending", toolName: "queue" },
        }),
      );
      return;
    }

    if (
      executionMode === "api" &&
      (!activeProfile?.api_key || !activeProfile?.api_base_url || !activeProfile?.model)
    ) {
      setExecutionPhase(activeTaskId, "error");
      toast.error(
        `${t("execution_error")}: ${t("api_key")} / ${t("api_base_url")} / ${t("model_required")}`,
      );
      return;
    }

    const preflight = useAppStore.getState().enginePreflight[activeEngineId];
    if (executionMode === "cli") {
      if (!preflight) {
        toast.error(`${t("execution_error")}: \u5f53\u524d\u5f15\u64ce ${activeEngineId} \u5c1a\u672a\u5b8c\u6210\u68c0\u6d4b\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5\u3002`);
        return;
      }
      if (!preflight.command_exists || !preflight.auth_ok) {
        toast.error(`${t("execution_error")}: \u5f53\u524d\u5f15\u64ce ${activeEngineId} \u4e0d\u53ef\u7528\u3002\u8bf7\u5728\u8bbe\u7f6e\u4e2d\u5b8c\u6210 CLI \u914d\u7f6e\u3002`);
        return;
      }
    }

    await runExecution(finalContent, executionMode);
  };

  const handleStop = async () => {
    if (!activeTaskId) return;
    try {
      await stopExecution();
      const activeTask = useAppStore.getState().tasks.find((t) => t.id === activeTaskId);
      if (activeTask?.sessionId) {
        await stopSession({ session_id: activeTask.sessionId });
      }
    } catch { /* ignore */ }
    clearQueue();
    // store clearing will happen via backend event execution_cancelled
  };

  const handleRemovePendingAttachment = useCallback(
    (path: string) => {
      if (!activeTaskId) return;
      removePendingAttachmentByTask(activeTaskId, path);
    },
    [activeTaskId, removePendingAttachmentByTask],
  );

  return {
    input,
    setInput,
    executionPhase,
    handleSend,
    handleStop,
    handleRetry,
    handleCopy,
    pendingAttachments,
    removePendingAttachment: handleRemovePendingAttachment,
  };
}
