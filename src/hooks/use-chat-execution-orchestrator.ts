import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { createMessage } from "../components/chat/createMessage";
import { useEngineStoreState, useTaskStoreState } from "./use-app-store-selectors";
import { useTranslation } from "../i18n";
import { useChatStore } from "../stores/chatStore";
import { useChatAgent } from "./useChatAgent";
import { useExecutionQueue } from "./useExecutionQueue";
import { useAgentExecutor } from "./useAgentExecutor";
import type { ExecutionEvent } from "../services/ExecutionClient";
import type { ChatApiMessage, ChatChoicePayload, EngineProfile, RunEvent } from "../types";

export interface UseChatExecutionOrchestratorParams {
  activeTaskId: string | null;
  activeEngineId: string;
  activeProfileId: string | null;
  activeProfile: EngineProfile | null;
  executionMode: "api" | "cli";
  input: string;
  setInput: (value: string) => void;
}

function buildMessageContentWithAttachments(message: {
  content: string;
  attachments?: { path: string }[];
}): string {
  const attachmentNotes = (message.attachments || [])
    .map((attachment) => `[File: ${attachment.path}]`)
    .join("\n");
  if (!attachmentNotes) {
    return message.content;
  }
  if (!message.content.trim()) {
    return attachmentNotes;
  }
  return `${attachmentNotes}\n\n${message.content}`;
}

export function useChatExecutionOrchestrator({
  activeTaskId,
  activeEngineId,
  activeProfileId,
  activeProfile,
  executionMode,
  input,
  setInput,
}: UseChatExecutionOrchestratorParams) {
  const { t } = useTranslation();
  const { tasks, updateTaskRecord, updateTaskRuntimeBinding } = useTaskStoreState();
  const { enginePreflight } = useEngineStoreState();

  const isRunning = useChatStore((s) => s.getTaskRunning(activeTaskId));
  const pendingAttachments = useChatStore((s) => s.getTaskPendingAttachments(activeTaskId));
  const addMessage = useChatStore((s) => s.addMessage);
  const updateMessage = useChatStore((s) => s.updateMessage);
  const setTaskRunning = useChatStore((s) => s.setTaskRunning);
  const addRunEvent = useChatStore((s) => s.addRunEvent);
  const setRunVerification = useChatStore((s) => s.setRunVerification);
  const clearPendingAttachmentsByTask = useChatStore((s) => s.clearPendingAttachments);
  const removePendingAttachmentByTask = useChatStore((s) => s.removePendingAttachment);
  const executionPhase = useChatStore((s) => s.taskExecutionPhase[activeTaskId ?? ""] || "idle");
  const setExecutionPhase = useChatStore((s) => s.setExecutionPhase);
  const activeRunId = useChatStore((s) => s.taskActiveRunId[activeTaskId ?? ""]);
  const setActiveRunId = useChatStore((s) => s.setActiveRunId);
  const setActiveAssistantMsgId = useChatStore((s) => s.setActiveAssistantMsgId);

  const { stopSession, saveLastConversation } = useChatAgent();
  const { queue, pushQueue, popQueue, clearQueue } = useExecutionQueue();
  const { startExecution, stopExecution } = useAgentExecutor(
    executionMode,
    useCallback(
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
              failRoundRef.current?.(`命令执行失败（退出码：${event.exitCode}）`);
            } else {
              finalizeRoundRef.current?.();
            }
            break;
          case "error":
            failRoundRef.current?.(event.message);
            break;
        }
      },
      [activeRunId, activeTaskId, setRunVerification],
    ),
  );

  const runExecutionRef = useRef<
    ((content: string, mode: "api" | "cli") => Promise<void>) | null
  >(null);
  const cliContinuationRef = useRef(false);
  const finalizeRoundRef = useRef<(() => void) | null>(null);
  const failRoundRef = useRef<((errText: string) => void) | null>(null);

  const createChoiceSystemMessage = useCallback(
    (content: string, choice: ChatChoicePayload) => {
      if (!activeTaskId) return;
      addMessage(
        activeTaskId,
        createMessage("system", content, {
          meta: {
            eventType: "notice",
            eventStatus: "pending",
            toolName: "choice",
            choice,
          },
        }),
      );
    },
    [activeTaskId, addMessage],
  );

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
    [activeRunId, activeTaskId, addRunEvent],
  );

  const finalizeRound = useCallback(() => {
    if (!activeTaskId) return;

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
    activeRunId,
    activeTaskId,
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
            onClick: () => window.open("https://docs.cursor.com/agent/trust", "_blank"),
          },
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
      t,
      updateTaskRecord,
    ],
  );

  const recoverExecutionLocally = useCallback(
    (assistantMsgId: string, errText: string) => {
      if (!activeTaskId) return;
      const currentRunId = useChatStore.getState().taskActiveRunId[activeTaskId];
      if (currentRunId) {
        return;
      }
      setTaskRunning(activeTaskId, false);
      setExecutionPhase(activeTaskId, "error");
      updateMessage(activeTaskId, assistantMsgId, {
        content: errText,
        status: "error",
      });
      setActiveAssistantMsgId(activeTaskId, null);
      setActiveRunId(activeTaskId, null);
    },
    [
      activeTaskId,
      setActiveAssistantMsgId,
      setActiveRunId,
      setExecutionPhase,
      setTaskRunning,
      updateMessage,
    ],
  );

  finalizeRoundRef.current = finalizeRound;
  failRoundRef.current = failRound;

  const buildApiMessages = useCallback((): ChatApiMessage[] => {
    if (!activeTaskId) return [];
    const list = useChatStore.getState().messages[activeTaskId] || [];
    return list
      .filter(
        (message) =>
          (message.role === "system" || message.role === "user" || message.role === "assistant") &&
          !!message.content.trim() &&
          !message.meta?.choice,
      )
      .map((message) => ({
        role: message.role === "system" ? "system" : message.role === "assistant" ? "assistant" : "user",
        content: buildMessageContentWithAttachments(message),
      }));
  }, [activeTaskId]);

  const buildApiMessageIds = useCallback((): string[] => {
    if (!activeTaskId) return [];
    const list = useChatStore.getState().messages[activeTaskId] || [];
    return list
      .filter(
        (message) =>
          (message.role === "system" || message.role === "user" || message.role === "assistant") &&
          !!message.content.trim() &&
          !message.meta?.choice,
      )
      .map((message) => message.id);
  }, [activeTaskId]);

  const runExecution = useCallback(
    async (content: string, mode: "api" | "cli") => {
      if (!activeTaskId) return;
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
        if (mode === "api") {
          const allMessages = useChatStore.getState().messages[activeTaskId] || [];
          await saveLastConversation({
            task_id: activeTaskId,
            messages: allMessages,
            saved_at: Date.now(),
          });
        }
        const request = mode === "api"
          ? {
              engine_id: activeEngineId,
              profile_id: activeProfileId,
              task_id: activeTaskId,
              message_ids: buildApiMessageIds(),
              messages: buildApiMessages(),
              max_input_tokens: 12000,
              max_messages: 48,
            }
          : {
              engine_id: activeEngineId,
              profile_id: activeProfileId,
              task_id: activeTaskId,
              prompt: content,
              is_continuation: cliContinuationRef.current,
            };

        const result = await startExecution(request);
        const runId = result.run_id || `run-pending-${Date.now()}`;
        setActiveRunId(activeTaskId, runId);
        updateTaskRuntimeBinding(activeTaskId, { activeExecId: result.exec_id, activeRunId: runId });
      } catch (error) {
        const errText = String(error);
        failRound(errText);
        recoverExecutionLocally(assistantMsg.id, errText);
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
      failRound,
      recoverExecutionLocally,
      saveLastConversation,
      setActiveAssistantMsgId,
      setActiveRunId,
      setExecutionPhase,
      setTaskRunning,
      startExecution,
      updateTaskRecord,
      updateTaskRuntimeBinding,
    ],
  );

  runExecutionRef.current = runExecution;

  useEffect(() => {
    if (activeTaskId && (executionPhase === "completed" || executionPhase === "error")) {
      const timer = setTimeout(() => setExecutionPhase(activeTaskId, "idle"), 600);
      return () => clearTimeout(timer);
    }
  }, [activeTaskId, executionPhase, setExecutionPhase]);

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
  }, [activeTaskId, executionPhase, isRunning, popQueue, queue.length, setExecutionPhase]);

  useEffect(() => {
    cliContinuationRef.current = false;
  }, [activeEngineId, activeTaskId, executionMode]);

  const handleSend = useCallback(async () => {
    if (!activeTaskId) return;
    const trimmedInput = input.trim();
    if (!trimmedInput && pendingAttachments.length === 0) return;

    let finalContent = trimmedInput;
    const currentAttachments = [...pendingAttachments];
    if (currentAttachments.length > 0) {
      const attachmentNotes = currentAttachments.map((attachment) => `[File: ${attachment.path}]`).join("\n");
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
      createChoiceSystemMessage("当前 API 模式缺少必要配置，暂时无法发起请求。", {
        title: "补全 API 配置",
        description: "至少需要填写 API Key、Base URL 和模型标识，或者切回 CLI 模式继续。",
        status: "pending",
        options: [
          {
            id: "open-settings",
            label: "打开设置",
            description: "前往设置页补全 API 提供商配置。",
            action: { kind: "open_settings" },
          },
          {
            id: "switch-cli",
            label: "切换到 CLI",
            description: "如果本地 CLI 已可用，可以先切回 CLI 模式。",
            action: { kind: "switch_execution_mode", mode: "cli" },
          },
        ],
      });
      return;
    }

    const preflightKey = activeProfileId ? `${activeEngineId}::${activeProfileId}` : activeEngineId;
    const preflight = enginePreflight[preflightKey] || enginePreflight[activeEngineId];
    if (executionMode === "cli") {
      if (!preflight) {
        toast.error(`${t("execution_error")}: 当前引擎 ${activeEngineId} 尚未完成检测，请稍后再试。`);
        createChoiceSystemMessage(`当前引擎 ${activeEngineId} 尚未完成 CLI 检测。`, {
          title: "CLI 检测尚未完成",
          description: "你可以先打开设置查看检测状态，或者改用 API 模式继续。",
          status: "pending",
          options: [
            {
              id: "open-settings",
              label: "打开设置",
              description: "查看引擎状态并重新触发检测。",
              action: { kind: "open_settings" },
            },
            {
              id: "switch-api",
              label: "切换到 API",
              description: "如果当前 Provider 支持 API，可先改用 API 模式。",
              action: { kind: "switch_execution_mode", mode: "api" },
            },
          ],
        });
        return;
      }
      if (!preflight.command_exists || !preflight.auth_ok) {
        toast.error(`${t("execution_error")}: 当前引擎 ${activeEngineId} 不可用。请在设置中完成 CLI 配置。`);
        createChoiceSystemMessage(`当前引擎 ${activeEngineId} 的 CLI 还不可用。`, {
          title: "CLI 尚不可用",
          description: "通常是命令不存在、未登录或鉴权未通过。你可以进入设置修复，或切换到 API 模式。",
          status: "pending",
          options: [
            {
              id: "open-settings",
              label: "打开设置",
              description: "检查命令路径、登录状态和预检结果。",
              action: { kind: "open_settings" },
            },
            {
              id: "switch-api",
              label: "切换到 API",
              description: "如果当前 Provider 支持 API，可先改用 API 模式。",
              action: { kind: "switch_execution_mode", mode: "api" },
            },
          ],
        });
        return;
      }
    }

    await runExecution(finalContent, executionMode);
  }, [
    activeEngineId,
    activeProfile?.api_base_url,
    activeProfile?.api_key,
    activeProfile?.model,
    activeProfileId,
    activeTaskId,
    addMessage,
    clearPendingAttachmentsByTask,
    createChoiceSystemMessage,
    executionMode,
    input,
    isRunning,
    pendingAttachments,
    pushQueue,
    runExecution,
    setExecutionPhase,
    setInput,
    t,
    enginePreflight,
  ]);

  const handleStop = useCallback(async () => {
    if (!activeTaskId) return;
    try {
      await stopExecution();
      const activeTask = tasks.find((task) => task.id === activeTaskId);
      if (activeTask?.sessionId) {
        await stopSession({ session_id: activeTask.sessionId });
      }
    } catch (error) {
      console.error("停止执行时出错:", error);
    }
    clearQueue();
  }, [activeTaskId, clearQueue, stopExecution, stopSession, tasks]);

  const removePendingAttachment = useCallback(
    (path: string) => {
      if (!activeTaskId) return;
      removePendingAttachmentByTask(activeTaskId, path);
    },
    [activeTaskId, removePendingAttachmentByTask],
  );

  return {
    executionPhase,
    handleSend,
    handleStop,
    pendingAttachments,
    removePendingAttachment,
  };
}
