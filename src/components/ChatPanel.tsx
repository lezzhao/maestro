import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Paperclip, 
  SendHorizontal, 
  Square, 
  RefreshCcw, 
  X, 
  PlusCircle, 
  Cpu,
  MessageSquare
} from "lucide-react";
import { Badge } from "./ui/badge";
import { useChatStore } from "../stores/chatStore";
import { useChatAgent } from "../hooks/useChatAgent";
import { useAppStore } from "../stores/appStore";
import { useTranslation } from "../i18n";
import { cn } from "../lib/utils";
import { ChatMessageItem } from "./ChatMessageItem";
import { decodeTransportEscapes, normalizeTerminalChunk } from "../lib/utils/terminal";
import type { ChatMessage, EngineConfig } from "../types";

interface ChatLabels {
  inputPlaceholder: string;
  roleUser: string;
  roleAssistant: string;
  roleSystem: string;
  roleAuto: string;
  thinking: string;
  noOutputYet: string;
  live: string;
  expandResult: string;
  collapseResult: string;
}

interface MessageListProps {
  taskId: string;
  chatLabels: ChatLabels;
  handleRetry: (id: string) => void;
  handleCopy: (content: string) => void;
  t: any;
  executionPhaseLabel: string;
}

const MessageList = memo(function MessageList({
  taskId,
  chatLabels,
  handleRetry,
  handleCopy,
  t,
  executionPhaseLabel,
}: MessageListProps) {
  const messages = useChatStore((s) => s.getTaskMessages(taskId));
  const isRunning = useChatStore((s) => s.isRunning);
  const listRef = useRef<HTMLDivElement>(null);
  const scrollRequestRef = useRef<number | null>(null);
  const autoScrollEnabledRef = useRef(true);
  const [autoScrollAllowed, setAutoScrollAllowed] = useState(true);
  const [windowPages, setWindowPages] = useState(1);
  const WINDOW_SIZE = 80;

  const windowStart = Math.max(0, messages.length - windowPages * WINDOW_SIZE);
  const hiddenCount = windowStart;
  const windowedMessages = messages.slice(windowStart);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    if (scrollRequestRef.current) cancelAnimationFrame(scrollRequestRef.current);
    
    scrollRequestRef.current = requestAnimationFrame(() => {
      if (!listRef.current) return;
      listRef.current.scrollTo({ top: listRef.current.scrollHeight, behavior });
    });
  }, []);

  const handleScroll = () => {
    if (!listRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = listRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 60;
    if (autoScrollEnabledRef.current !== isAtBottom) {
      autoScrollEnabledRef.current = isAtBottom;
      setAutoScrollAllowed(isAtBottom);
    }
  };

  useEffect(() => {
    if (isRunning && autoScrollEnabledRef.current) {
      scrollToBottom();
    } else if (!isRunning && messages.length > 0 && autoScrollEnabledRef.current) {
      scrollToBottom("auto");
    }
  }, [messages, isRunning, scrollToBottom]);

  useEffect(() => {
    if (messages.length > 0 && autoScrollEnabledRef.current) {
      setWindowPages(1);
      const timer = setTimeout(() => scrollToBottom("auto"), 10);
      return () => clearTimeout(timer);
    }
  }, [messages.length, scrollToBottom]);

  return (
    <div
      ref={listRef}
      onScroll={handleScroll}
      className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4 space-y-4 relative"
      style={{ willChange: "scroll-position" }}
    >
        <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center opacity-60">
          <h3 className="text-sm font-semibold text-text-main mb-1">{t("empty_chat_title")}</h3>
          <p className="text-xs text-text-muted max-w-[240px] leading-relaxed">
            {t("empty_chat_desc")}
          </p>
        </div>

      {messages.length > 0 && (
        <div className="sticky top-0 z-10 -mx-2 px-2 py-1 mb-1 bg-bg-base/90">
          <div className="inline-flex items-center gap-2 rounded-lg border border-border-muted bg-bg-surface px-2.5 py-1 text-[10px] font-semibold text-text-muted uppercase">
            <span className={cn("w-1.5 h-1.5 rounded-full", isRunning ? "bg-emerald-500" : "bg-text-muted/30")} />
            {executionPhaseLabel}
          </div>
        </div>
      )}

      {hiddenCount > 0 && (
        <div className="flex justify-center">
          <button
            type="button"
            className="text-[11px] px-3 py-1 rounded-full border border-border-subtle text-text-muted hover:text-text-main hover:border-border-muted transition-colors"
            onClick={() => setWindowPages((p) => p + 1)}
          >
            {t("load_more_messages", { n: hiddenCount })}
          </button>
        </div>
      )}

      <AnimatePresence initial={false}>
        {windowedMessages.map((message) => (
          <ChatMessageItem
            key={message.id}
            message={message}
            minimalMode={true}
            labels={chatLabels}
            isRunning={isRunning}
            onRetry={handleRetry}
            onCopy={handleCopy}
          />
        ))}
      </AnimatePresence>

      <AnimatePresence>
        {!autoScrollAllowed && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="absolute bottom-4 right-4 z-10"
          >
            <button
              onClick={() => { autoScrollEnabledRef.current = true; scrollToBottom(); }}
              className="flex items-center gap-2 pl-3 pr-4 py-1.5 rounded-lg bg-bg-surface border border-border-muted shadow-sm hover:border-primary-500 transition-colors"
            >
              <RefreshCcw size={12} className="text-primary-500" />
              <span className="text-[10px] font-semibold text-text-muted uppercase">
                {t("scroll_to_bottom")}
              </span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

interface ChatInputProps {
  input: string;
  setInput: (input: string) => void;
  isRunning: boolean;
  pendingAttachments: { path: string; name: string }[];
  removePendingAttachment: (path: string) => void;
  handleSend: () => Promise<void>;
  handleStop: () => Promise<void>;
  placeholder: string;
}

const ChatInput = memo(function ChatInput({
  input,
  setInput,
  isRunning,
  pendingAttachments,
  removePendingAttachment,
  handleSend,
  handleStop,
  placeholder,
}: ChatInputProps) {
  return (
    <div className="pb-3 px-2">
      <div className="bg-bg-surface border border-border-muted/40 rounded-xl overflow-hidden shadow-sm transition-colors focus-within:border-primary-500/40">
        <AnimatePresence>
          {pendingAttachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 p-3 border-b border-border-muted/5">
              {pendingAttachments.map((att) => (
                <Badge key={att.path} variant="secondary" className="h-6 gap-1.5 px-2 bg-bg-base border-border-muted/20 text-text-muted text-[9px] font-bold">
                  <span className="max-w-[100px] truncate">{att.name}</span>
                  <button onClick={() => removePendingAttachment(att.path)} className="hover:text-rose-500"><X size={10} /></button>
                </Badge>
              ))}
            </div>
          )}
        </AnimatePresence>

        <div className="flex flex-col">
          <textarea
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (input.trim() || pendingAttachments.length > 0) void handleSend();
              }
            }}
            placeholder={placeholder}
            className="w-full bg-transparent border-none focus:ring-0 text-[14px] leading-relaxed py-3 px-4 resize-none min-h-[50px] max-h-[250px] text-text-main placeholder:text-text-muted/30"
            rows={1}
          />
          
          <div className="flex items-center justify-between px-3 pb-2.5">
            <div className="flex items-center gap-1 opacity-60">
              <button className="w-8 h-8 flex items-center justify-center rounded-lg text-text-muted hover:text-text-main transition-colors">
                <PlusCircle size={16} />
              </button>
              <button className="w-8 h-8 flex items-center justify-center rounded-lg text-text-muted hover:text-text-main transition-colors">
                <Paperclip size={16} />
              </button>
            </div>

            {!isRunning ? (
              <button
                disabled={!input.trim() && pendingAttachments.length === 0}
                onClick={handleSend}
                className={cn(
                  "w-8 h-8 flex items-center justify-center rounded-lg transition-all",
                  input.trim() || pendingAttachments.length > 0
                    ? "bg-primary-500 text-white shadow-sm hover:bg-primary-600"
                    : "text-text-muted/20 cursor-not-allowed"
                )}
              >
                <SendHorizontal size={16} />
              </button>
            ) : (
              <div className="flex items-center gap-2">
                 <button
                  onClick={handleSend}
                  disabled={!input.trim()}
                  className={cn(
                    "h-7 px-3 flex items-center justify-center rounded-md text-[10px] font-black uppercase tracking-widest transition-all",
                    input.trim() 
                      ? "bg-primary-500 text-white shadow-md active:scale-95" 
                      : "bg-bg-base text-text-muted/30 border border-border-muted/10 cursor-not-allowed"
                  )}
                >
                  Confirm
                </button>
                <button
                  onClick={handleStop}
                  className="w-8 h-8 flex items-center justify-center rounded-lg bg-rose-500/10 text-rose-500 hover:bg-rose-500 hover:text-white transition-all shadow-sm"
                >
                  <Square size={12} fill="currentColor" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

type ChatPanelProps = {
  projectPath: string;
  engines: Record<string, EngineConfig>;
  activeEngineId: string;
};

export function ChatPanel({
  projectPath,
  engines,
  activeEngineId,
}: ChatPanelProps) {
  const { t } = useTranslation();
  
  const activeTaskId = useAppStore((s) => s.activeTaskId);
  const activeTask = useAppStore((s) => s.tasks.find(t => t.id === activeTaskId));
  const updateActiveTask = useAppStore((s) => s.updateActiveTask);
  
  const messages = useChatStore((s) => s.getTaskMessages(activeTaskId));
  const messageCount = messages.length;
  const isRunning = useChatStore((s) => s.isRunning);
  const pendingAttachments = useChatStore((s) => s.pendingAttachments);
  
  const addMessage = useChatStore((s) => s.addMessage);
  const setMessages = useChatStore((s) => s.setMessages);
  const updateMessage = useChatStore((s) => s.updateMessage);
  const appendToMessage = useChatStore((s) => s.appendToMessage);
  const setRunning = useChatStore((s) => s.setRunning);
  const removePendingAttachment = useChatStore((s) => s.removePendingAttachment);
  const clearPendingAttachments = useChatStore((s) => s.clearPendingAttachments);
  const clearMessages = useChatStore((s) => s.clearMessages);
  
  const { spawnSession, sendMessage, stopSession, saveLastConversation } = useChatAgent();
  const setErrorMessage = useAppStore((s) => s.setErrorMessage);

  const [input, setInput] = useState("");
  const [executionPhase, setExecutionPhase] = useState<
    "idle" | "connecting" | "sending" | "streaming" | "completed" | "error"
  >("idle");
  const activeAssistantIdRef = useRef<string | null>(null);
  const finalizeTimerRef = useRef<number | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const chunkBufferRef = useRef<string>("");
  const updateTimerRef = useRef<number | null>(null);
  const lastChunkAtRef = useRef(0);

  const activeEngine = engines[activeEngineId];
  const activeProfile = useMemo(() => {
    const profiles = activeEngine?.profiles || {};
    if (!profiles || Object.keys(profiles).length === 0) return undefined;
    const profileId =
      activeEngine?.active_profile_id && profiles[activeEngine.active_profile_id]
        ? activeEngine.active_profile_id
        : Object.keys(profiles)[0];
    return profileId ? profiles[profileId] : undefined;
  }, [activeEngine]);
  const readySignal = activeProfile?.ready_signal?.trim() || "";
  
  const handleRetry = useCallback((messageId: string) => {
    if (!activeTaskId) return;
    const messages = useChatStore.getState().messages[activeTaskId] || [];
    const idx = messages.findIndex(m => m.id === messageId);
    if (idx <= 0) return;
    const prevUserMessage = messages.slice(0, idx).reverse().find(m => m.role === "user");
    if (!prevUserMessage) return;
    const userMsgIdx = messages.findIndex(m => m.id === prevUserMessage.id);
    setMessages(activeTaskId, messages.slice(0, userMsgIdx + 1));
    setInput(prevUserMessage.content);
  }, [activeTaskId, setMessages]);

  const handleCopy = useCallback((content: string) => {
    void navigator.clipboard.writeText(content);
  }, []);

  const persistConversation = useCallback(async () => {
    if (!activeTaskId) return;
    try {
      const messages = useChatStore.getState().messages[activeTaskId] || [];
      await saveLastConversation({ messages, saved_at: Date.now() });
    } catch { /* Silent */ }
  }, [activeTaskId, saveLastConversation]);

  useEffect(() => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      void persistConversation();
    }, isRunning ? 1200 : 350);
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [isRunning, messageCount, persistConversation]);

  const flushBufferedChunks = useCallback(() => {
    if (!activeTaskId || !activeAssistantIdRef.current || !chunkBufferRef.current) return;
    const delta = chunkBufferRef.current;
    chunkBufferRef.current = "";
    appendToMessage(activeTaskId, activeAssistantIdRef.current, delta);
  }, [activeTaskId, appendToMessage]);

  const finalizeRound = useCallback(
    (force = false) => {
      if (!activeTaskId) return;
      flushBufferedChunks();
      const assistantId = activeAssistantIdRef.current;
      if (!assistantId) return;
      const list = useChatStore.getState().messages[activeTaskId] || [];
      const assistant = list.find((m) => m.id === assistantId);
      if (!assistant) return;
      const content = assistant.content || "";
      if (!force && readySignal && !content.includes(readySignal)) return;
      if (!force && Date.now() - lastChunkAtRef.current < 1200) return;
      updateMessage(activeTaskId, assistantId, { status: "done", content: content.trimEnd() });
      activeAssistantIdRef.current = null;
      setRunning(false);
      setExecutionPhase("completed");
      updateActiveTask({ status: "completed" });
      window.setTimeout(() => setExecutionPhase("idle"), 1000);
    },
    [activeTaskId, flushBufferedChunks, readySignal, setRunning, updateActiveTask, updateMessage],
  );

  const scheduleFinalize = useCallback(() => {
    if (finalizeTimerRef.current) window.clearTimeout(finalizeTimerRef.current);
    finalizeTimerRef.current = window.setTimeout(() => {
      const idleForMs = Date.now() - lastChunkAtRef.current;
      if (idleForMs > 2200) {
        finalizeRound(true);
      } else if (activeAssistantIdRef.current) {
        scheduleFinalize();
      }
    }, 800);
  }, [finalizeRound]);

  useEffect(
    () => () => {
      if (updateTimerRef.current) window.clearTimeout(updateTimerRef.current);
      if (finalizeTimerRef.current) window.clearTimeout(finalizeTimerRef.current);
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    },
    [],
  );

  const ensureSession = useCallback(async () => {
    if (activeTask?.sessionId) return activeTask.sessionId;
    const meta = await spawnSession(
      {
        engine_id: activeEngineId,
        profile_id: activeEngine?.active_profile_id || null,
      },
      (chunk) => {
        lastChunkAtRef.current = Date.now();
        setExecutionPhase("streaming");
        const normalized = normalizeTerminalChunk(decodeTransportEscapes(chunk));
        if (!normalized) {
          scheduleFinalize();
          return;
        }
        chunkBufferRef.current += normalized;
        if (!updateTimerRef.current) {
          updateTimerRef.current = window.setTimeout(() => {
            flushBufferedChunks();
            updateTimerRef.current = null;
          }, 60);
        }
        scheduleFinalize();
      },
    );
    updateActiveTask({ sessionId: meta.session_id });
    return meta.session_id;
  }, [
    activeEngine?.active_profile_id,
    activeEngineId,
    activeTask?.sessionId,
    flushBufferedChunks,
    scheduleFinalize,
    spawnSession,
    updateActiveTask,
  ]);

  const handleSend = async () => {
    if (!activeTaskId) return;
    const trimmedInput = input.trim();
    if (!trimmedInput && pendingAttachments.length === 0) return;

    if (isRunning && activeTask?.sessionId) {
      setInput("");
      try {
        setExecutionPhase("sending");
        await sendMessage({
          session_id: activeTask.sessionId,
          content: trimmedInput,
          append_newline: true,
        });
        addMessage(activeTaskId,
          createMessage("system", t("event_instruction_sent"), {
            meta: { eventType: "tool", eventStatus: "done", toolName: "chat_send" },
          }),
        );
      } catch (err) {
        setExecutionPhase("error");
        setErrorMessage(t("execution_error") + ": " + String(err));
      }
      return;
    }

    const currentAttachments = [...pendingAttachments];
    setInput("");
    clearPendingAttachments();
    addMessage(activeTaskId, createMessage("user", trimmedInput, { attachments: currentAttachments }));
    setRunning(true);
    updateActiveTask({ status: "running" });
    setExecutionPhase("connecting");
    chunkBufferRef.current = "";
    
    try {
      const assistantMsg = createMessage("assistant", "", {
        status: "streaming",
        meta: { engineId: activeEngineId, profileId: activeProfile?.id },
      });
      addMessage(activeTaskId, assistantMsg);
      activeAssistantIdRef.current = assistantMsg.id;
      
      if (!activeTask?.sessionId) {
        addMessage(activeTaskId,
          createMessage("system", t("event_connecting_engine"), {
            meta: { eventType: "status", eventStatus: "pending", toolName: activeEngineId },
          }),
        );
      }
      const sessionId = await ensureSession();
      
      let finalContent = trimmedInput;
      if (currentAttachments.length > 0) {
        const attachmentNotes = currentAttachments.map(a => `[File: ${a.path}]`).join("\n");
        finalContent = `${attachmentNotes}\n\n${trimmedInput}`;
      }

      setExecutionPhase("sending");
      await sendMessage({
        session_id: sessionId,
        content: finalContent,
        append_newline: true,
      });
      addMessage(activeTaskId,
        createMessage("system", t("event_instruction_sent"), {
          meta: { eventType: "tool", eventStatus: "done", toolName: "chat_send" },
        }),
      );
      scheduleFinalize();
      
    } catch (err) {
      setExecutionPhase("error");
      setErrorMessage(t("execution_error") + ": " + String(err));
      setRunning(false);
      updateActiveTask({ status: "error" });
      if (activeAssistantIdRef.current) {
        updateMessage(activeTaskId, activeAssistantIdRef.current, { status: "error" });
      }
    } finally {
      if (updateTimerRef.current) {
        window.clearTimeout(updateTimerRef.current);
        flushBufferedChunks();
        updateTimerRef.current = null;
      }
    }
  };

  const handleStop = async () => {
    if (!activeTaskId) return;
    if (activeTask?.sessionId) {
      try { await stopSession({ session_id: activeTask.sessionId }); } catch (e) { console.error(e); }
    }
    if (finalizeTimerRef.current) window.clearTimeout(finalizeTimerRef.current);
    if (updateTimerRef.current) window.clearTimeout(updateTimerRef.current);
    flushBufferedChunks();
    if (activeAssistantIdRef.current) {
      updateMessage(activeTaskId, activeAssistantIdRef.current, { status: "done" });
      activeAssistantIdRef.current = null;
    }
    setRunning(false);
    updateActiveTask({ status: "idle" });
    setExecutionPhase("idle");
  };

  const chatLabels = useMemo(() => ({
    inputPlaceholder: projectPath ? t("input_placeholder") : t("input_placeholder_no_project"),
    roleUser: t("role_user"),
    roleAssistant: t("role_assistant"),
    roleSystem: t("role_system"),
    roleAuto: t("role_auto"),
    thinking: t("thinking"),
    noOutputYet: t("no_output_yet"),
    live: t("live"),
    expandResult: t("expand_result"),
    collapseResult: t("collapse_result"),
  }), [projectPath, t]);

  const statusLabel = isRunning ? t("status_processing") : t("status_idle");
  const executionPhaseLabel =
    executionPhase === "connecting"
      ? t("stage_connecting")
      : executionPhase === "sending"
        ? t("stage_sending")
        : executionPhase === "streaming"
          ? t("stage_streaming")
          : executionPhase === "completed"
            ? t("stage_done")
            : t("stage_idle");

  if (!activeTaskId) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 text-center bg-bg-base/30 backdrop-blur-sm">
        <div className="w-16 h-16 rounded-2xl bg-bg-elevated flex items-center justify-center text-text-muted/20 mb-6">
           <MessageSquare size={32} />
        </div>
        <h3 className="text-xl font-bold text-text-main mb-2">
          {t("no_active_task") || "No Active Task"}
        </h3>
        <p className="text-xs text-text-muted max-w-xs leading-relaxed font-medium opacity-60">
          {t("create_task_prompt") || "Select a task from the sidebar or create a new one to start working."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full gap-2 px-1 animate-in fade-in duration-500">
      <div className="flex items-center justify-between h-10 px-2 border-b border-border-muted/10 shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className={cn(
              "w-1.5 h-1.5 rounded-full",
              isRunning ? "bg-emerald-500" : "bg-text-muted/20"
            )} />
            <span className="text-[10px] font-semibold text-text-muted uppercase">
              {statusLabel}
            </span>
          </div>
          
          <div className="flex items-center gap-2 text-text-muted/60">
            <Cpu size={12} />
            <span className="text-[10px] font-medium truncate max-w-[120px]">
              {activeEngine?.display_name}
              <span className="ml-1 opacity-50">{activeProfile?.model || "Auto"}</span>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => clearMessages(activeTaskId)}
            className="text-text-muted hover:text-rose-500 p-1 transition-colors"
            title={t("clear_chat")}
          >
            <RefreshCcw size={12} />
          </button>
        </div>
      </div>

      <MessageList 
        taskId={activeTaskId}
        chatLabels={chatLabels}
        handleRetry={handleRetry}
        handleCopy={handleCopy}
        t={t}
        executionPhaseLabel={executionPhaseLabel}
      />

      <ChatInput 
        input={input}
        setInput={setInput}
        isRunning={isRunning}
        pendingAttachments={pendingAttachments}
        removePendingAttachment={removePendingAttachment}
        handleSend={handleSend}
        handleStop={handleStop}
        placeholder={chatLabels.inputPlaceholder}
      />
    </div>
  );
}

function createMessage(
  role: ChatMessage["role"],
  content: string,
  patch?: Partial<ChatMessage>,
): ChatMessage {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    role,
    content,
    timestamp: Date.now(),
    ...patch,
  };
}
