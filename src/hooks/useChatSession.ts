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
import { useBatchedTranscript } from "./useBatchedTranscript";
import type { ExecutionEvent } from "../services/ExecutionClient";
import type { ChatApiMessage, EngineProfile, RunEvent } from "../types";

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
  const setErrorMessage = useAppStore((s) => s.setErrorMessage);

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
    useBatchedTranscript(appendRunTranscript);
  const addRunArtifact = useChatStore((s) => s.addRunArtifact);
  const setRunVerification = useChatStore((s) => s.setRunVerification);
  const clearPendingAttachmentsByTask = useChatStore((s) => s.clearPendingAttachments);
  const removePendingAttachmentByTask = useChatStore((s) => s.removePendingAttachment);

  const { stopSession, saveLastConversation } = useChatAgent();
  const { pushQueue, popQueue, clearQueue } = useExecutionQueue();
  const { handleRetry: baseHandleRetry, handleCopy } = useChatInputHistory(activeTaskId, isRunning);

  const [input, setInput] = useState("");
  const [executionPhase, setExecutionPhase] = useState<
    "idle" | "connecting" | "sending" | "streaming" | "completed" | "error"
  >("idle");

  const handleRetry = useCallback((id: string) => {
    baseHandleRetry(id, setInput);
  }, [baseHandleRetry, setInput]);

  const activeAssistantIdRef = useRef<string | null>(null);
  const currentRunIdRef = useRef<string | null>(null);
  const isExecutingRef = useRef(false);
  const cliContinuationRef = useRef(false);

  const emitRunEvent = useCallback(
    (patch: Omit<RunEvent, "id" | "taskId" | "createdAt" | "runId">) => {
      if (!activeTaskId) return;
      const runId = currentRunIdRef.current;
      if (!runId) return;
      const event: RunEvent = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        taskId: activeTaskId,
        runId,
        createdAt: Date.now(),
        ...patch,
      };
      addRunEvent(runId, event);
    },
    [activeTaskId, addRunEvent],
  );

  const runExecutionRef = useRef<
    ((content: string, mode: "api" | "cli") => Promise<void>) | null
  >(null);

  const finalizeRound = useCallback(() => {
    if (!activeTaskId) return;
    const assistantId = activeAssistantIdRef.current;
    if (assistantId) {
      updateMessage(activeTaskId, assistantId, { status: "done" });
    }
    activeAssistantIdRef.current = null;
    isExecutingRef.current = false;
    setTaskRunning(activeTaskId, false);
    setRunning(false);
    setExecutionPhase("completed");

    const finishedRunId = currentRunIdRef.current;
    const verification = finishedRunId
      ? useChatStore.getState().getRunVerification(finishedRunId)
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

    if (finishedRunId) {
      finishRun(finishedRunId, "done", null);
      currentRunIdRef.current = null;
    }
    updateTaskRuntimeBinding(activeTaskId, { activeExecId: null, activeRunId: null, sessionId: null });
    cliContinuationRef.current = executionMode === "cli";
    window.setTimeout(() => setExecutionPhase("idle"), 600);

    const next = popQueue();
    if (next) {
      window.setTimeout(() => {
        void runExecutionRef.current?.(next.content, next.mode);
      }, 80);
    }
  }, [
    activeEngineId,
    activeTaskId,
    emitRunEvent,
    executionMode,
    finishRun,
    popQueue,
    setRunning,
    setTaskRunning,
    updateMessage,
    updateTaskRecord,
    updateTaskRuntimeBinding,
  ]);

  const failRound = useCallback(
    (errText: string) => {
      if (!activeTaskId) return;
      setExecutionPhase("error");
      setErrorMessage(`${t("execution_error")}: ${errText}`);
      updateTaskRecord(activeTaskId, { status: "error" });

      const assistantId = activeAssistantIdRef.current;
      if (assistantId) {
        updateMessage(activeTaskId, assistantId, { status: "error" });
      }
      activeAssistantIdRef.current = null;
      isExecutingRef.current = false;
      setTaskRunning(activeTaskId, false);
      setRunning(false);

      emitRunEvent({
        kind: "error",
        status: "error",
        message: errText,
        engineId: activeEngineId,
        mode: executionMode,
      });

      if (currentRunIdRef.current) {
        finishRun(currentRunIdRef.current, "error", errText);
        currentRunIdRef.current = null;
      }
      updateTaskRuntimeBinding(activeTaskId, { activeExecId: null, activeRunId: null, sessionId: null });
      cliContinuationRef.current = false;

      const next = popQueue();
      if (next) {
        emitRunEvent({
          kind: "notice",
          status: "pending",
          message: "上一条失败，继续执行下一条排队消息",
          engineId: activeEngineId,
          mode: next.mode,
        });
        window.setTimeout(() => {
          void runExecutionRef.current?.(next.content, next.mode);
        }, 80);
      }
    },
    [
      activeEngineId,
      activeTaskId,
      emitRunEvent,
      executionMode,
      finishRun,
      popQueue,
      setErrorMessage,
      updateTaskRecord,
      updateTaskRuntimeBinding,
      setRunning,
      setTaskRunning,
      t,
      updateMessage,
      updateTaskRecord,
      updateTaskRuntimeBinding,
    ],
  );

  const handleExecutionEvent = useCallback(
    (event: ExecutionEvent) => {
      if (!activeTaskId || !activeAssistantIdRef.current) return;

      switch (event.type) {
        case "runId":
          currentRunIdRef.current = event.runId;
          break;
        case "done":
          flushTranscript();
          if (event.exitCode !== undefined && event.exitCode !== 0 && event.exitCode !== null) {
            failRound(`命令执行失败（退出码：${event.exitCode}）`);
          } else {
            finalizeRound();
          }
          break;
        case "error":
          flushTranscript();
          failRound(event.message);
          break;
        case "verification":
          if (currentRunIdRef.current) {
            setRunVerification(currentRunIdRef.current, event.verification);
          }
          break;
        case "text": {
          setExecutionPhase("streaming");
          appendToMessage(activeTaskId, activeAssistantIdRef.current, event.text);
          if (currentRunIdRef.current) {
            appendTranscriptChunk(currentRunIdRef.current, event.text);
            if (executionMode !== "api") {
              addRunArtifact(currentRunIdRef.current, {
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                runId: currentRunIdRef.current,
                kind: "log",
                label: "终端输出片段",
                value: event.text.slice(0, 400),
                createdAt: Date.now(),
              });
            }
          }
          break;
        }
      }
    },
    [
      activeTaskId,
      addRunArtifact,
      appendTranscriptChunk,
      appendToMessage,
      executionMode,
      failRound,
      finalizeRound,
      flushTranscript,
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
      const startedAt = Date.now();
      currentRunIdRef.current = null;
      setRunning(true);
      setTaskRunning(activeTaskId, true);
      isExecutingRef.current = true;
      setExecutionPhase("connecting");
      updateTaskRecord(activeTaskId, { status: "running" });
      updateTaskRuntimeBinding(activeTaskId, { sessionId: null, activeExecId: null, activeRunId: null });

      const assistantMsg = createMessage("assistant", "", {
        status: "streaming",
        meta: { engineId: activeEngineId, profileId: activeProfile?.id },
      });
      addMessage(activeTaskId, assistantMsg);
      activeAssistantIdRef.current = assistantMsg.id;

      try {
        setExecutionPhase("sending");
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
              // Fallback payload: Rust 优先从持久化+ID恢复，缺失时使用该列表
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
        const runId = result.run_id || `run-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        currentRunIdRef.current = runId;

        // Run is created by run_created event (backend authoritative). Only create locally on error.
        emitRunEvent({
          kind: "status",
          status: "pending",
          message: `开始执行（${mode.toUpperCase()}）`,
          engineId: activeEngineId,
          mode,
        });

        updateTaskRuntimeBinding(activeTaskId, { activeExecId: result.exec_id, activeRunId: runId });
        // updateRun when run exists (created by run_created event)
        updateRun(runId, { status: "running" });
      } catch (err) {
        if (!currentRunIdRef.current) {
          const failedRunId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          currentRunIdRef.current = failedRunId;
          createRun({
            id: failedRunId,
            taskId: activeTaskId,
            engineId: activeEngineId,
            mode,
            status: "running",
            createdAt: startedAt,
            startedAt,
          });
        }
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
      createRun,
      emitRunEvent,
      failRound,
      saveLastConversation,
      setRunning,
      setTaskRunning,
      startExecution,
      updateRun,
      updateTaskRecord,
      updateTaskRuntimeBinding,
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

    if (isExecutingRef.current) {
      pushQueue({ content: finalContent, mode: executionMode });
      addMessage(
        activeTaskId,
        createMessage("system", t("queued_hint"), {
          meta: { eventType: "notice", eventStatus: "pending", toolName: "queue" },
        }),
      );
      emitRunEvent({
        kind: "notice",
        status: "pending",
        message: "消息已排队，等待当前执行结束",
        engineId: activeEngineId,
        mode: executionMode,
      });
      return;
    }

    if (
      executionMode === "api" &&
      (!activeProfile?.api_key || !activeProfile?.api_base_url || !activeProfile?.model)
    ) {
      setExecutionPhase("error");
      setErrorMessage(
        `${t("execution_error")}: ${t("api_key")} / ${t("api_base_url")} / ${t("model_required")}`,
      );
      return;
    }

    const preflight = useAppStore.getState().enginePreflight[activeEngineId];
    if (executionMode === "cli") {
      if (!preflight) {
        setErrorMessage(
          `${t("execution_error")}: \u5f53\u524d\u5f15\u64ce ${activeEngineId} \u5c1a\u672a\u5b8c\u6210\u68c0\u6d4b\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5\u3002`,
        );
        return;
      }
      if (!preflight.command_exists || !preflight.auth_ok) {
        const fallbackEngineId = Object.entries(useAppStore.getState().enginePreflight).find(
          ([engineId, result]) =>
            engineId !== activeEngineId && result.command_exists && result.auth_ok,
        )?.[0];
        if (fallbackEngineId && activeTaskId) {
          const activeTask = useAppStore.getState().tasks.find((t) => t.id === activeTaskId);
          void invoke("task_switch_runtime_binding", {
            request: {
              taskId: activeTaskId,
              engineId: fallbackEngineId,
              sessionId: activeTask?.sessionId ?? null,
            },
          });
          setErrorMessage(
            `${t("execution_error")}: \u5f53\u524d\u5f15\u64ce ${activeEngineId} \u4e0d\u53ef\u7528\uff08\u547d\u4ee4\u6216auth\u5931\u8d25\uff09\uff0c\u5df2\u5207\u6362\u5230 ${fallbackEngineId}\u3002\u8bf7\u91cd\u65b0\u53d1\u9001\u3002`,
          );
        } else {
          setErrorMessage(
            `${t("execution_error")}: \u5f53\u524d\u5f15\u64ce ${activeEngineId} \u4e0d\u53ef\u7528\u3002\u8bf7\u5728\u8bbe\u7f6e\u4e2d\u5b8c\u6210 CLI \u914d\u7f6e\u3002`,
          );
        }
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
    } catch {
      // ignore
    }

    clearQueue();
    isExecutingRef.current = false;
    if (currentRunIdRef.current) {
      finishRun(currentRunIdRef.current, "stopped", null);
      currentRunIdRef.current = null;
    }
    cliContinuationRef.current = false;
    const assistantId = activeAssistantIdRef.current;
    if (assistantId) {
      updateMessage(activeTaskId, assistantId, { status: "done" });
      activeAssistantIdRef.current = null;
    }
    setTaskRunning(activeTaskId, false);
    setRunning(false);
    setExecutionPhase("idle");
    updateTaskRecord(activeTaskId, { status: "idle" });
    updateTaskRuntimeBinding(activeTaskId, { activeExecId: null, activeRunId: null, sessionId: null });
    emitRunEvent({
      kind: "notice",
      status: "done",
      message: "任务已手动停止",
      engineId: activeEngineId,
      mode: executionMode,
    });
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
