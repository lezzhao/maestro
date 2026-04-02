import { memo, useCallback, useEffect, useRef, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowDown } from "lucide-react";
import { Virtuoso, VirtuosoHandle } from "react-virtuoso";
import { ChatMessageItem } from "../ChatMessageItem";
import { useTaskChatState } from "../../hooks/use-task-chat-state";
import { recordPerf } from "../../lib/utils/perf";
import type { TranslationFn } from "../../i18n";
import type { ChatChoiceOption, ChatMessage } from "../../types";
import { NewChatLanding } from "./NewChatLanding";

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
  taskId: string | null;
  chatLabels: ChatLabels;
  handleRetry: (id: string) => void;
  handleCopy: (content: string) => void;
  handleChoiceSelect?: (message: ChatMessage, option: ChatChoiceOption) => void | Promise<void>;
  onActionClick?: (text: string) => void;
  t: TranslationFn;
}

export const MessageList = memo(function MessageList({
  taskId,
  chatLabels,
  handleRetry,
  handleCopy,
  handleChoiceSelect,
  onActionClick,
  t,
}: MessageListProps) {
  const { messages, isRunning, latestRun, latestRunEvents, latestTranscript } = useTaskChatState(taskId);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const autoScrollEnabledRef = useRef(true);
  const [autoScrollAllowed, setAutoScrollAllowed] = useState(true);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

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

  useEffect(() => {
    const handleScrollEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ id: string }>;
      const messageId = customEvent.detail.id;
      const index = messages.findIndex(m => m.id === messageId);
      if (index !== -1) {
        autoScrollEnabledRef.current = false;
        setAutoScrollAllowed(false);
        virtuosoRef.current?.scrollToIndex({
          index,
          align: "center",
          behavior: "smooth"
        });
        setHighlightedId(messageId);
        setTimeout(() => setHighlightedId(null), 3000);
      }
    };

    window.addEventListener("maestro:scroll-to-message", handleScrollEvent);
    return () => window.removeEventListener("maestro:scroll-to-message", handleScrollEvent);
  }, [messages]);

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
        <NewChatLanding onActionClick={(text) => onActionClick?.(text)} />
      ) : (
        <Virtuoso
          ref={virtuosoRef}
          className="h-full w-full custom-scrollbar"
          data={messages}
          atBottomStateChange={handleScroll}
          initialTopMostItemIndex={messages.length - 1}
          increaseViewportBy={300}
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
                  isHighlighted={highlightedId === message.id}
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
          <motion.button
            initial={{ opacity: 0, y: 10, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.9 }}
            onClick={() => {
              autoScrollEnabledRef.current = true;
              scrollToBottom("smooth");
            }}
            className="absolute bottom-8 right-8 p-3 rounded-full bg-primary text-white shadow-glow hover:scale-110 active:scale-95 transition-all z-10 group border border-primary/20"
            title={t("scroll_to_bottom")}
          >
            <ArrowDown size={18} className="group-hover:translate-y-0.5 transition-transform" />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
});
