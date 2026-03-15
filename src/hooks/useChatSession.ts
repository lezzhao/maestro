import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChatStore } from "../stores/chatStore";
import { useChatAgent } from "./useChatAgent";
import { useAppStore } from "../stores/appStore";
import { useTranslation } from "../i18n";
import { createMessage } from "../components/chat/createMessage";
import {
  decodeTransportEscapes,
  extractReadableTerminalChunk,
  normalizeTerminalChunk,
} from "../lib/utils/terminal";
import {
  CTRL_DONE,
  CTRL_ERROR,
  CTRL_EXIT,
  CTRL_RUN_ID,
  CTRL_VERIFICATION,
  isControlChunk,
  parseErrorChunk,
  parseExitCodeChunk,
  parseRunIdChunk,
  parseVerificationChunk,
} from "../lib/utils/controlChunks";
import type {
  ChatApiMessage,
  EngineConfig,
  EngineProfile,
  RunEvent,
  VerificationSummary,
} from "../types";

interface UseChatSessionParams {
  activeTaskId: string | null;
  activeEngineId: string;
  activeEngine: EngineConfig | undefined;
  activeProfile: EngineProfile | undefined;
}

type QueueItem = {
  content: string;
  mode: "api" | "cli";
};

type RunningExec = {
  execId: number;
  mode: "api" | "cli";
};

export function useChatSession({
  activeTaskId,
  activeEngineId,
  activeEngine,
  activeProfile,
}: UseChatSessionParams) {
  const { t } = useTranslation();
  const activeTask = useAppStore((s) => s.tasks.find((tk) => tk.id === activeTaskId));
  const updateTask = useAppStore((s) => s.updateTask);
  const setErrorMessage = useAppStore((s) => s.setErrorMessage);
  const setActiveEngineId = useAppStore((s) => s.setActiveEngineId);

  const messages = useChatStore((s) => s.getTaskMessages(activeTaskId));
  const messageCount = messages.length;
  const isRunning = useChatStore((s) => s.getTaskRunning(activeTaskId));
  const pendingAttachments = useChatStore((s) => s.getTaskPendingAttachments(activeTaskId));
  const addMessage = useChatStore((s) => s.addMessage);
  const setMessages = useChatStore((s) => s.setMessages);
  const updateMessage = useChatStore((s) => s.updateMessage);
  const appendToMessage = useChatStore((s) => s.appendToMessage);
  const setRunning = useChatStore((s) => s.setRunning);
  const setTaskRunning = useChatStore((s) => s.setTaskRunning);
  const createRun = useChatStore((s) => s.createRun);
  const finishRun = useChatStore((s) => s.finishRun);
  const updateRun = useChatStore((s) => s.updateRun);
  const addRunEvent = useChatStore((s) => s.addRunEvent);
  const appendRunTranscript = useChatStore((s) => s.appendRunTranscript);
  const addRunArtifact = useChatStore((s) => s.addRunArtifact);
  const setRunVerification = useChatStore((s) => s.setRunVerification);
  const removePendingAttachmentByTask = useChatStore((s) => s.removePendingAttachment);
  const clearPendingAttachmentsByTask = useChatStore((s) => s.clearPendingAttachments);

  const {
    executeApi,
    executeCli,
    stopApi,
    stopCli,
    stopSession,
    saveLastConversation,
  } = useChatAgent();

  const [input, setInput] = useState("");
  const [executionPhase, setExecutionPhase] = useState<
    "idle" | "connecting" | "sending" | "streaming" | "completed" | "error"
  >("idle");

  const saveTimerRef = useRef<number | null>(null);
  const activeAssistantIdRef = useRef<string | null>(null);
  const currentExecRef = useRef<RunningExec | null>(null);
  const currentRunIdRef = useRef<string | null>(null);
  const queueRef = useRef<QueueItem[]>([]);
  const isExecutingRef = useRef(false);
  const cliContinuationRef = useRef(false);
  const runExecutionRef = useRef<
    ((content: string, mode: "api" | "cli") => Promise<void>) | null
  >(null);

  const executionMode = useMemo(
    () => ((activeProfile?.execution_mode || "cli") as "api" | "cli"),
    [activeProfile?.execution_mode],
  );

  const persistConversation = useCallback(async () => {
    if (!activeTaskId) return;
    try {
      const allMessages = useChatStore.getState().messages[activeTaskId] || [];
      await saveLastConversation({ messages: allMessages, saved_at: Date.now() });
    } catch {
      // 忽略持久化失败，避免影响交互
    }
  }, [activeTaskId, saveLastConversation]);

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

  useEffect(() => {
    cliContinuationRef.current = false;
  }, [activeEngineId, activeTaskId, executionMode]);

  useEffect(() => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(
      () => {
        void persistConversation();
      },
      isRunning ? 1200 : 350,
    );
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [isRunning, messageCount, persistConversation]);

  const handleRetry = useCallback(
    (messageId: string) => {
      if (!activeTaskId) return;
      const allMessages = useChatStore.getState().messages[activeTaskId] || [];
      const idx = allMessages.findIndex((m) => m.id === messageId);
      if (idx <= 0) return;
      const prevUserMessage = allMessages
        .slice(0, idx)
        .reverse()
        .find((m) => m.role === "user");
      if (!prevUserMessage) return;
      const userMsgIdx = allMessages.findIndex((m) => m.id === prevUserMessage.id);
      setMessages(activeTaskId, allMessages.slice(0, userMsgIdx + 1));
      setInput(prevUserMessage.content);
    },
    [activeTaskId, setMessages],
  );

  const handleCopy = useCallback((content: string) => {
    void navigator.clipboard.writeText(content);
  }, []);

  const finalizeRound = useCallback(() => {
    if (!activeTaskId) return;
    const assistantId = activeAssistantIdRef.current;
    if (assistantId) {
      updateMessage(activeTaskId, assistantId, { status: "done" });
    }
    activeAssistantIdRef.current = null;
    currentExecRef.current = null;
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
    updateTask(activeTaskId, { status: nextStatus });
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
    updateTask(activeTaskId, { activeExecId: null, activeRunId: null, sessionId: null });
    cliContinuationRef.current = executionMode === "cli";
    window.setTimeout(() => setExecutionPhase("idle"), 600);

    const next = queueRef.current.shift();
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
    setRunning,
    setTaskRunning,
    updateTask,
    updateMessage,
  ]);

  const failRound = useCallback(
    (errText: string) => {
      if (!activeTaskId) return;
      setExecutionPhase("error");
      setErrorMessage(`${t("execution_error")}: ${errText}`);
      updateTask(activeTaskId, { status: "error" });
      const assistantId = activeAssistantIdRef.current;
      if (assistantId) {
        updateMessage(activeTaskId, assistantId, { status: "error" });
      }
      activeAssistantIdRef.current = null;
      currentExecRef.current = null;
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
      updateTask(activeTaskId, { activeExecId: null, activeRunId: null, sessionId: null });
      cliContinuationRef.current = false;

      const next = queueRef.current.shift();
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
      setErrorMessage,
      setRunning,
      setTaskRunning,
      t,
      updateTask,
      updateMessage,
      finishRun,
    ],
  );

  const handleChunk = useCallback(
    (chunk: string) => {
      if (!activeTaskId || !activeAssistantIdRef.current) return;
      if (isControlChunk(chunk)) {
        if (chunk.startsWith(CTRL_RUN_ID)) {
          const parsedRunId = parseRunIdChunk(chunk);
          if (parsedRunId) {
            currentRunIdRef.current = parsedRunId;
          }
          return;
        }
        if (chunk.startsWith(CTRL_DONE)) {
          finalizeRound();
          return;
        }
        if (chunk.startsWith(CTRL_EXIT)) {
          const exitCode = parseExitCodeChunk(chunk);
          if (exitCode === 0) {
            finalizeRound();
          } else {
            const text =
              exitCode === null
                ? "命令执行失败（未知退出码）"
                : `命令执行失败（退出码：${exitCode}）`;
            failRound(text);
          }
          return;
        }
        if (chunk.startsWith(CTRL_ERROR)) {
          failRound(parseErrorChunk(chunk));
          return;
        }
        if (chunk.startsWith(CTRL_VERIFICATION)) {
          const runId = currentRunIdRef.current;
          if (!runId) return;
          const verification = parseVerificationChunk<VerificationSummary>(chunk);
          if (verification) {
            setRunVerification(runId, verification);
          }
          return;
        }
      }

      setExecutionPhase("streaming");
      const runId = currentRunIdRef.current;
      if (executionMode === "api") {
        appendToMessage(activeTaskId, activeAssistantIdRef.current, chunk);
        if (runId) {
          appendRunTranscript(runId, chunk);
        }
        return;
      }

      const decoded = decodeTransportEscapes(chunk);
      const normalized = normalizeTerminalChunk(decoded) || extractReadableTerminalChunk(decoded);
      if (!normalized) return;
      appendToMessage(activeTaskId, activeAssistantIdRef.current, normalized);
      if (runId) {
        appendRunTranscript(runId, normalized);
        addRunArtifact(runId, {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          runId,
          kind: "log",
          label: "终端输出片段",
          value: normalized.slice(0, 400),
          createdAt: Date.now(),
        });
      }
    },
    [
      activeTaskId,
      addRunArtifact,
      appendRunTranscript,
      appendToMessage,
      executionMode,
      failRound,
      finalizeRound,
      setRunVerification,
    ],
  );

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

  const runExecution = useCallback(
    async (content: string, mode: "api" | "cli") => {
      if (!activeTaskId) return;
      const startedAt = Date.now();
      currentRunIdRef.current = null;
      setRunning(true);
      setTaskRunning(activeTaskId, true);
      isExecutingRef.current = true;
      setExecutionPhase("connecting");
      updateTask(activeTaskId, { status: "running", sessionId: null, activeExecId: null, activeRunId: null });

      const assistantMsg = createMessage("assistant", "", {
        status: "streaming",
        meta: { engineId: activeEngineId, profileId: activeProfile?.id },
      });
      addMessage(activeTaskId, assistantMsg);
      activeAssistantIdRef.current = assistantMsg.id;

      try {
        if (mode === "api") {
          setExecutionPhase("sending");
          const result = await executeApi(
            {
              engine_id: activeEngineId,
              profile_id: activeEngine?.active_profile_id || null,
              task_id: activeTaskId,
              messages: buildApiMessages(),
            },
            handleChunk,
          );
          const runId = result.run_id || `run-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          currentRunIdRef.current = runId;
          createRun({
            id: runId,
            taskId: activeTaskId,
            engineId: activeEngineId,
            mode,
            status: "running",
            createdAt: startedAt,
            startedAt,
          });
          emitRunEvent({
            kind: "status",
            status: "pending",
            message: `开始执行（${mode.toUpperCase()}）`,
            engineId: activeEngineId,
            mode,
          });
          currentExecRef.current = { execId: result.exec_id, mode: "api" };
          updateTask(activeTaskId, { activeExecId: result.exec_id, activeRunId: runId });
          updateRun(runId, { status: "running" });
        } else {
          setExecutionPhase("sending");
          const result = await executeCli(
            {
              engine_id: activeEngineId,
              profile_id: activeEngine?.active_profile_id || null,
              task_id: activeTaskId,
              prompt: content,
              is_continuation: cliContinuationRef.current,
            },
            handleChunk,
          );
          const runId = result.run_id || `run-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          currentRunIdRef.current = runId;
          createRun({
            id: runId,
            taskId: activeTaskId,
            engineId: activeEngineId,
            mode,
            status: "running",
            createdAt: startedAt,
            startedAt,
          });
          emitRunEvent({
            kind: "status",
            status: "pending",
            message: `开始执行（${mode.toUpperCase()}）`,
            engineId: activeEngineId,
            mode,
          });
          currentExecRef.current = { execId: result.exec_id, mode: "cli" };
          updateTask(activeTaskId, { activeExecId: result.exec_id, activeRunId: runId });
          updateRun(runId, { status: "running" });
        }
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
      activeEngine?.active_profile_id,
      activeEngineId,
      activeProfile?.id,
      activeTaskId,
      addMessage,
      buildApiMessages,
      createRun,
      executeApi,
      executeCli,
      emitRunEvent,
      failRound,
      handleChunk,
      setRunning,
      setTaskRunning,
      updateRun,
      updateTask,
    ],
  );

  runExecutionRef.current = runExecution;

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
      queueRef.current.push({
        content: finalContent,
        mode: executionMode,
      });
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
    if (
      executionMode === "cli" &&
      preflight &&
      (!preflight.command_exists || !preflight.auth_ok)
    ) {
      const fallbackEngineId = Object.entries(useAppStore.getState().enginePreflight).find(
        ([engineId, result]) =>
          engineId !== activeEngineId && result.command_exists && result.auth_ok,
      )?.[0];
      if (fallbackEngineId) {
        setActiveEngineId(fallbackEngineId);
        setErrorMessage(
          `${t("execution_error")}: 当前引擎 ${activeEngineId} 不可用，已切换到 ${fallbackEngineId}。`,
        );
      } else {
        setErrorMessage(
          `${t("execution_error")}: 当前引擎 ${activeEngineId} 不可用，请先完成 CLI 配置。`,
        );
      }
      return;
    }

    await runExecution(finalContent, executionMode);
  };

  const handleStop = async () => {
    if (!activeTaskId) return;
    const runningExec =
      currentExecRef.current ??
      (activeTask?.activeExecId
        ? {
            execId: activeTask.activeExecId,
            mode: executionMode,
          }
        : null);
    try {
      if (runningExec) {
        if (runningExec.mode === "api") {
          await stopApi({ exec_id: runningExec.execId });
        } else {
          await stopCli({ exec_id: runningExec.execId });
        }
      }
      if (activeTask?.sessionId) {
        await stopSession({ session_id: activeTask.sessionId });
      }
    } catch {
      // 忽略停止失败
    }

    queueRef.current = [];
    currentExecRef.current = null;
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
    updateTask(activeTaskId, { status: "idle", activeExecId: null, activeRunId: null, sessionId: null });
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

  useEffect(
    () => () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    },
    [],
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
