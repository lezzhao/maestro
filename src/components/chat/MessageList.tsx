import { memo, useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { RefreshCcw } from "lucide-react";
import { ChatMessageItem } from "../ChatMessageItem";
import { cn } from "../../lib/utils";
import { useChatStore } from "../../stores/chatStore";
import { recordPerf } from "../../lib/utils/perf";
import type { TranslationFn } from "../../i18n";

export interface ChatLabels {
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

export interface MessageListProps {
  taskId: string;
  chatLabels: ChatLabels;
  handleRetry: (id: string) => void;
  handleCopy: (content: string) => void;
  t: TranslationFn;
  executionPhaseLabel: string;
  showExecutionTrace: boolean;
}

const WINDOW_SIZE = 80;

export const MessageList = memo(function MessageList({
  taskId,
  chatLabels,
  handleRetry,
  handleCopy,
  t,
  executionPhaseLabel,
  showExecutionTrace,
}: MessageListProps) {
  const messages = useChatStore((s) => s.getTaskMessages(taskId));
  const isRunning = useChatStore((s) => s.getTaskRunning(taskId));
  const latestRun = useChatStore((s) => s.getLatestRun(taskId));
  const latestRunEvents = useChatStore((s) => s.getRunEvents(latestRun?.id || null));
  const latestTranscript = useChatStore((s) => s.getRunTranscript(latestRun?.id || null));
  const listRef = useRef<HTMLDivElement>(null);
  const scrollRequestRef = useRef<number | null>(null);
  const autoScrollEnabledRef = useRef(true);
  const [autoScrollAllowed, setAutoScrollAllowed] = useState(true);
  const [windowPages, setWindowPages] = useState(1);

  const windowStart = Math.max(0, messages.length - windowPages * WINDOW_SIZE);
  const hiddenCount = windowStart;
  const windowedMessages = messages.slice(windowStart);
  const systemEvents = latestRunEvents.slice(-6);
  const streamingAssistant = latestTranscript[latestTranscript.length - 1];

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

  useEffect(() => {
    const start = performance.now();
    const frame = requestAnimationFrame(() => {
      const duration = performance.now() - start;
      recordPerf("chat_message_list_commit", duration, {
        taskId,
        messageCount: messages.length,
        isRunning,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [taskId, messages.length, isRunning]);

  return (
    <div
      ref={listRef}
      onScroll={handleScroll}
      className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4 space-y-4 relative"
      style={{ willChange: "scroll-position" }}
    >
      {messages.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center opacity-60">
          <h3 className="text-sm font-semibold text-text-main mb-1">{t("empty_chat_title")}</h3>
          <p className="text-xs text-text-muted max-w-[240px] leading-relaxed">
            {t("empty_chat_desc")}
          </p>
        </div>
      )}

      {messages.length > 0 && (
        <div className="sticky top-0 z-10 -mx-2 px-2 py-1 mb-1 bg-bg-base/90">
          <div className="inline-flex items-center gap-2 rounded-lg border border-border-muted bg-bg-surface px-2.5 py-1 text-[10px] font-semibold text-text-muted uppercase">
            <span className={cn("w-1.5 h-1.5 rounded-full", isRunning ? "bg-emerald-500" : "bg-text-muted/30")} />
            {executionPhaseLabel}
          </div>
        </div>
      )}

      {showExecutionTrace && (systemEvents.length > 0 || streamingAssistant?.content) && (
        <div className="rounded-lg border border-border-muted bg-bg-surface p-2.5 space-y-2">
          <div className="text-[10px] font-semibold uppercase text-text-muted">
            {t("execution_trace_title")}
          </div>
          {systemEvents.length > 0 && (
            <div className="space-y-1.5">
              {systemEvents.map((evt) => (
                <div key={evt.id} className="text-[11px] text-text-main/85 leading-relaxed">
                  <span className="text-text-muted mr-2">
                    {new Date(evt.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </span>
                  {evt.message}
                </div>
              ))}
            </div>
          )}
          {streamingAssistant?.content && (
            <div className="rounded-md border border-border-subtle bg-bg-base/50 p-2">
              <div className="text-[10px] font-semibold uppercase text-text-muted mb-1">
                {t("execution_trace_live_output")}
              </div>
              <div className="text-[11px] text-text-main/80 whitespace-pre-wrap wrap-break-word leading-relaxed">
                {streamingAssistant.content.slice(-300)}
              </div>
            </div>
          )}
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
