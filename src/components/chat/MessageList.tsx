import { memo, useCallback, useEffect, useRef, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { RefreshCcw } from "lucide-react";
import { Virtuoso, VirtuosoHandle } from "react-virtuoso";
import { ChatMessageItem } from "../ChatMessageItem";
import { useTaskChatState } from "../../hooks/use-task-chat-state";
import { recordPerf } from "../../lib/utils/perf";
import type { TranslationFn } from "../../i18n";
import type { ChatChoiceOption, ChatMessage } from "../../types";

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
  handleChoiceSelect?: (message: ChatMessage, option: ChatChoiceOption) => void | Promise<void>;
  t: TranslationFn;
}

export const MessageList = memo(function MessageList({
  taskId,
  chatLabels,
  handleRetry,
  handleCopy,
  handleChoiceSelect,
  t,
}: MessageListProps) {
  const { messages, isRunning, latestRun, latestRunEvents, latestTranscript } = useTaskChatState(taskId);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const autoScrollEnabledRef = useRef(true);
  const [autoScrollAllowed, setAutoScrollAllowed] = useState(true);

  const systemEvents = latestRunEvents.slice(-6);

  const liveTranscriptText = useMemo(() => {
    if (!isRunning || latestRun?.status !== "running") return undefined;
    if (latestTranscript.length > 0) {
      return latestTranscript.slice(-1200);
    }
    if (systemEvents.length > 0) {
      return systemEvents.map((e) => e.message).join("\n");
    }
    return undefined;
  }, [isRunning, latestRun?.status, latestTranscript, systemEvents]);

  const scrollToBottom = useCallback((behavior: "auto" | "smooth" = "smooth") => {
    virtuosoRef.current?.scrollToIndex({ index: "LAST", align: "end", behavior });
  }, []);

  const handleScroll = (isAtBottom: boolean) => {
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
    <div className="flex-1 min-h-0 relative">
      {messages.length === 0 ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center opacity-60">
          <h3 className="text-sm font-semibold text-text-main mb-1">{t("empty_chat_title")}</h3>
          <p className="text-xs text-text-muted max-w-[240px] leading-relaxed">
            {t("empty_chat_desc")}
          </p>
        </div>
      ) : (
        <Virtuoso
          ref={virtuosoRef}
          className="h-full w-full custom-scrollbar"
          data={messages}
          atBottomStateChange={handleScroll}
          initialTopMostItemIndex={messages.length - 1}
          itemContent={(index, message) => (
            <div className={index === 0 ? "pt-2 pb-1" : "py-1"}>
                <ChatMessageItem
                message={message}
                minimalMode={true}
                labels={chatLabels}
                isRunning={isRunning}
                onRetry={handleRetry}
                onCopy={handleCopy}
                onChoiceSelect={handleChoiceSelect}
                liveTranscript={
                    index === messages.length - 1 ? liveTranscriptText : undefined
                }
                />
            </div>
          )}
        />
      )}

      <AnimatePresence>
        {!autoScrollAllowed && messages.length > 0 && (
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
