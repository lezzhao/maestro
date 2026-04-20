import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { createMessage } from "../../components/chat/createMessage";
import { useEngineStoreState, useTaskStoreState } from "../use-app-store-selectors";
import { useTranslation } from "../../i18n";
import { useChatStore } from "../../stores/chatStore";
import { useAppStore } from "../../stores/appStore";
import { useChatAgent } from "../useChatAgent";
import { useExecutionQueue } from "../useExecutionQueue";
import { useAgentExecutor } from "../useAgentExecutor";
import { useBatchedAppender } from "../useBatchedAppender";
import type { ExecutionEvent } from "../../services/ExecutionClient";
import type { ChatApiMessage, ChatChoicePayload, EngineProfile, RunEvent, ChatAttachment } from "../../types";

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
  const appendToMessage = useChatStore((s) => s.appendToMessage);
  const setTaskRunning = useChatStore((s) => s.setTaskRunning);
  const addRunEvent = useChatStore((s) => s.addRunEvent);
  const setRunVerification = useChatStore((s) => s.setRunVerification);
  const setExecutionLock = useChatStore((s) => s.setExecutionLock);
  const isLocked = useChatStore((s) => !!s.taskExecutionLock[activeTaskId ?? ""]);
  const clearPendingAttachmentsByTask = useChatStore((s) => s.clearPendingAttachments);
  const removePendingAttachmentByTask = useChatStore((s) => s.removePendingAttachment);
  const addPendingAttachmentsByTask = useChatStore((s) => s.addPendingAttachments);
  const executionPhase = useChatStore((s) => s.taskExecutionPhase[activeTaskId ?? ""] || "idle");
  const setExecutionPhase = useChatStore((s) => s.setExecutionPhase);
  const activeRunId = useChatStore((s) => s.taskActiveRunId[activeTaskId ?? "global"]);
  const setActiveRunId = useChatStore((s) => s.setActiveRunId);
  const setTaskStateToken = useChatStore((s) => s.setTaskStateToken);
  const setActiveAssistantMsgId = useChatStore((s) => s.setActiveAssistantMsgId);
  const activeConversationId = useChatStore((s) => s.activeConversationId[activeTaskId ?? "global"]);
  const pinnedFiles = useAppStore((s) => s.pinnedFiles);

  const { stopSession, saveLastConversation } = useChatAgent();
  const { queue, pushQueue, popQueue, clearQueue } = useExecutionQueue();
  
  const runExecutionRef = useRef<((content: string, mode: "api" | "cli") => Promise<void>) | null>(null);
  const cliContinuationRef = useRef(false);
  const finalizeRoundRef = useRef<(() => void) | null>(null);
  const failRoundRef = useRef<((errText: string) => void) | null>(null);
  
  // Industrial locks & mapping (Fix 4: Cross-talk prevention)
  const cycleAssistantMapRef = useRef<Record<string, string>>({});

  // Performance Optimization: Batched Streaming (Fix 8)
  const { appendChunk: appendStreamingTextChunk, flushNow: flushStreamingText } = 
    useBatchedAppender<string, string>((_taskId, msgId, content) => {
      if (activeTaskId) appendToMessage(activeTaskId, msgId, content);
    });

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


  const { startExecution, stopExecution } = useAgentExecutor(
    executionMode,
    useCallback(
      (event: ExecutionEvent) => {
        if (!activeTaskId) return;

        // Verify cycle identity to prevent stale state updates (Fix 3)
        const currentToken = useChatStore.getState().taskStateToken[activeTaskId];
        if (event.cycleId !== currentToken) {
          console.warn(`[Orchestrator] Ignoring stale event for task ${activeTaskId}: expected ${currentToken}, got ${event.cycleId}`);
          return;
        }

        switch (event.type) {
          case "runId":
            setActiveRunId(activeTaskId, event.runId);
            updateTaskRuntimeBinding(activeTaskId, { activeRunId: event.runId });
            break;
          case "text":
            // Use cycle-bound assistant message ID to prevent cross-talk (Fix 5)
            const boundMsgId = cycleAssistantMapRef.current[event.cycleId];
            if (boundMsgId) {
              appendStreamingTextChunk(activeTaskId, boundMsgId, event.text);
            } else {
              // Fallback to active ID if not mapped yet (unlikely but safe)
              const globalMsgId = useChatStore.getState().taskActiveAssistantMsgId[activeTaskId];
              if (globalMsgId) appendStreamingTextChunk(activeTaskId, globalMsgId, event.text);
            }
            break;
          case "reasoning":
            const reasoningMsgId = cycleAssistantMapRef.current[event.cycleId] || useChatStore.getState().taskActiveAssistantMsgId[activeTaskId];
            if (reasoningMsgId) {
              updateMessage(activeTaskId, reasoningMsgId, { reasoning: event.content });
            }
            break;
          case "verification":
            if (activeRunId) {
              setRunVerification(activeRunId, event.verification);
            }
            break;
          case "done":
            flushStreamingText();
            if (event.exitCode !== undefined && event.exitCode !== 0 && event.exitCode !== null) {
              failRoundRef.current?.(t("execution_failed_code", { code: event.exitCode }));
            } else {
              finalizeRoundRef.current?.();
            }
            break;
          case "toolApprovalRequest":
            createChoiceSystemMessage(
              `${t("tool_approval_title", { name: event.request.toolName })}\n${t("tool_approval_args", { args: JSON.stringify(event.request.arguments, null, 2) })}`,
              {
                title: t("high_risk_tool_title"),
                description: t("high_risk_tool_desc", { name: event.request.toolName }),
                status: "pending",
                options: [
                  {
                    id: "approve",
                    label: t("approve_execution"),
                    variant: "primary-gradient",
                    action: {
                      kind: "resolve_pending_tool",
                      requestId: event.request.requestId,
                      approved: true,
                    },
                  },
                  {
                    id: "reject",
                    label: t("reject"),
                    variant: "ghost",
                    action: {
                      kind: "resolve_pending_tool",
                      requestId: event.request.requestId,
                      approved: false,
                    },
                  },
                ],
              },
            );
            break;
          case "error":
            flushStreamingText();
            failRoundRef.current?.(event.message);
            break;
        }
      },
      [activeRunId, activeTaskId, setRunVerification, createChoiceSystemMessage, t],
    ),
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
      message: t("round_completed"),
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
    t,
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
        content: message.content,
        attachments: message.attachments?.map(a => ({
          name: a.name,
          path: a.path,
          mime_type: a.mime_type || "application/octet-stream",
          data: a.data || "",
        })),
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
      if (!activeTaskId || isLocked) return;
      
      setExecutionLock(activeTaskId, true);
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
          const allMessages = useChatStore.getState().messages[activeTaskId || "global"] || [];
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
              conversation_id: activeConversationId,
              message_ids: buildApiMessageIds(),
              messages: buildApiMessages(),
              pinned_files: pinnedFiles,
              assistant_message_id: assistantMsg.id,
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

        const cycleId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        setTaskStateToken(activeTaskId, cycleId);
        
        // Bind this assistant message to this specific cycle (Fix 6)
        cycleAssistantMapRef.current[cycleId] = assistantMsg.id;

        const result = await startExecution(activeTaskId, request, cycleId);
        const runId = result.run_id || `run-pending-${Date.now()}`;
        
        // Initial binding if not already handled by events
        if (!useChatStore.getState().taskActiveRunId[activeTaskId]) {
          setActiveRunId(activeTaskId, runId);
          updateTaskRuntimeBinding(activeTaskId, { activeExecId: result.exec_id, activeRunId: runId });
        }
      } catch (error) {
        const errText = String(error);
        failRound(errText);
        recoverExecutionLocally(assistantMsg.id, errText);
      } finally {
        setExecutionLock(activeTaskId, false);
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
      setTaskStateToken,
      setExecutionPhase,
      setTaskRunning,
      startExecution,
      updateTaskRecord,
      updateTaskRuntimeBinding,
      activeConversationId,
      pinnedFiles,
    ],
  );

  runExecutionRef.current = runExecution;

  useEffect(() => {
    if (activeTaskId && (executionPhase === "completed" || executionPhase === "error")) {
      const state = useChatStore.getState();
      const conversationId = activeConversationId;
      
      // Auto-titling logic: if it's the default title, try to generate a better one
      if (executionPhase === "completed" && conversationId) {
        const convo = state.conversationsByTask[activeTaskId || "global"]?.find(c => c.id === conversationId);
        if (convo && convo.title === t("new_conversation_default")) {
          state.generateTitle(conversationId);
        }
      }

      // Clear token after graceful completion or switch (Fix 7: Longer grace period)
      const timer = setTimeout(() => {
        setExecutionPhase(activeTaskId, "idle");
        setTaskStateToken(activeTaskId, "");
        // Clean up map for this cycle to save memory
        const currentToken = useChatStore.getState().taskStateToken[activeTaskId];
        if (!currentToken) {
           cycleAssistantMapRef.current = {};
        }
      }, 5000); // 5 seconds grace period
      return () => clearTimeout(timer);
    }
  }, [activeTaskId, executionPhase, setExecutionPhase, activeConversationId, t, setTaskStateToken]);

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
    
    // Mount-time zombie cleanup (Fix 2 for false "Queued" hint)
    if (activeTaskId && isRunning && !activeRunId) {
      console.warn(`[Orchestrator] Cleaning up zombie state on mount for task ${activeTaskId}`);
      setTaskRunning(activeTaskId, false);
      setExecutionPhase(activeTaskId, "idle");
    }
  }, [activeEngineId, activeTaskId, executionMode, isRunning, activeRunId, setTaskRunning, setExecutionPhase]);

  const handleSend = useCallback(async () => {
    if (!activeTaskId) return;
    const trimmedInput = input.trim();
    if (!trimmedInput && pendingAttachments.length === 0) return;

    let finalContent = trimmedInput;
    const currentAttachments = [...pendingAttachments];
    
    // For CLI mode, we still need to build text content with attachment path notes
    if (executionMode === "cli" && currentAttachments.length > 0) {
      finalContent = buildMessageContentWithAttachments({ content: trimmedInput, attachments: currentAttachments });
    }

    setInput("");
    clearPendingAttachmentsByTask(activeTaskId);
    addMessage(activeTaskId, createMessage("user", trimmedInput, { attachments: currentAttachments }));

    // Zombie execution state cleanup (Fix for false "Queued" hint)
    if (isRunning && !activeRunId && executionPhase !== "connecting" && executionPhase !== "sending") {
      console.warn(`[Orchestrator] Detected zombie running state for task ${activeTaskId}. Resetting...`);
      setTaskRunning(activeTaskId, false);
      setExecutionPhase(activeTaskId, "idle");
      // Continue with execution instead of queuing
    } else if (isRunning) {
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
      createChoiceSystemMessage(t("api_config_missing"), {
        title: t("complete_api_config"),
        description: t("api_config_desc"),
        status: "pending",
        options: [
          {
            id: "open-settings",
            label: t("open_settings"),
            description: t("go_to_settings_api"),
            action: { kind: "open_settings" },
          },
          {
            id: "switch-cli",
            label: t("switch_to_cli"),
            description: t("switch_to_cli_desc"),
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
        toast.error(`${t("execution_error")}: ${t("engine_preflight_pending", { id: activeEngineId })}`);
        createChoiceSystemMessage(t("engine_preflight_pending", { id: activeEngineId }), {
          title: t("cli_preflight_pending_title"),
          description: t("cli_preflight_pending_desc"),
          status: "pending",
          options: [
            {
              id: "open-settings",
              label: t("open_settings"),
              description: t("check_engine_status"),
              action: { kind: "open_settings" },
            },
            {
              id: "switch-api",
              label: t("switch_to_api"),
              description: t("switch_to_api_desc"),
              action: { kind: "switch_execution_mode", mode: "api" },
            },
          ],
        });
        return;
      }
      if (!preflight.command_exists || !preflight.auth_ok) {
        toast.error(`${t("execution_error")}: ${t("engine_unavailable", { id: activeEngineId })}`);
        createChoiceSystemMessage(t("engine_unavailable", { id: activeEngineId }), {
          title: t("cli_unavailable_title"),
          description: t("cli_unavailable_desc"),
          status: "pending",
          options: [
            {
              id: "open-settings",
              label: t("open_settings"),
              description: t("cli_fix_hint"),
              action: { kind: "open_settings" },
            },
            {
              id: "switch-api",
              label: t("switch_to_api"),
              description: t("switch_to_api_desc"),
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
      addMessage(
        activeTaskId,
        createMessage("system", "--- execution_interrupted ---", {
          meta: { eventType: "notice" },
        }),
      );
      setTaskRunning(activeTaskId, false);
      setExecutionPhase(activeTaskId, "idle");
      updateTaskRecord(activeTaskId, { status: "completed" });
      
      const sessionState = useChatStore.getState();
      const currentAssistantMsgId = sessionState.taskActiveAssistantMsgId[activeTaskId];
      if (currentAssistantMsgId) {
        updateMessage(activeTaskId, currentAssistantMsgId, { status: "completed" });
        setActiveAssistantMsgId(activeTaskId, null);
      }
      setActiveRunId(activeTaskId, null);
    } catch (error) {
      console.error("Error stopping execution:", error);
      toast.error(`${t("stop_failed")}: ${String(error)}`);
    }
    clearQueue();
  }, [activeTaskId, clearQueue, stopExecution, stopSession, tasks, t]);

  const removePendingAttachment = useCallback(
    (path: string) => {
      if (!activeTaskId) return;
      removePendingAttachmentByTask(activeTaskId, path);
    },
    [activeTaskId, removePendingAttachmentByTask],
  );

  const addPendingAttachments = useCallback(
    (attachments: ChatAttachment[]) => {
      if (!activeTaskId) return;
      addPendingAttachmentsByTask(activeTaskId, attachments);
    },
    [activeTaskId, addPendingAttachmentsByTask],
  );

  return {
    executionPhase,
    handleSend,
    handleStop,
    pendingAttachments,
    removePendingAttachment,
    addPendingAttachments,
  };
}
