import { memo, useMemo, useState } from "react";
import {
  Copy,
  RotateCcw,
  ThumbsUp,
  ThumbsDown,
  User,
  Bot,
  Sparkles,
  Wrench,
  CircleCheck,
  AlertTriangle,
} from "lucide-react";
import { ChatMessageContent } from "./ChatMessageContent";
import { cn } from "../lib/utils";
import { stripAnsi } from "../lib/utils/terminal";
import type { ChatMessage } from "../types";

type Labels = {
  roleUser: string;
  roleAuto: string;
  roleAssistant: string;
  roleSystem: string;
  thinking: string;
  noOutputYet: string;
  live: string;
  expandResult: string;
  collapseResult: string;
};

type Props = {
  message: ChatMessage;
  minimalMode: boolean;
  labels: Labels;
  isRunning?: boolean;
  onRetry?: (messageId: string) => void;
  onCopy?: (content: string) => void;
};

type ThoughtExtractResult = {
  thought: string | null;
  main: string;
};

function extractThoughtBlock(content: string): ThoughtExtractResult {
  const lines = content.split("\n");
  const thoughtLines: string[] = [];
  const mainLines: string[] = [];
  let inThought = false;

  const thoughtStartRe = /^\s*(?:#{1,6}\s*)?(?:thinking|thought|analysis|plan|思考|推理|分析|计划)\s*[:：]?\s*$/i;
  const answerStartRe = /^\s*(?:#{1,6}\s*)?(?:final|answer|result|结论|结果|回复)\s*[:：]?\s*$/i;

  for (const line of lines) {
    if (!inThought && thoughtStartRe.test(line)) {
      inThought = true;
      continue;
    }
    if (inThought && answerStartRe.test(line)) {
      inThought = false;
      continue;
    }
    if (inThought) {
      thoughtLines.push(line);
    } else {
      mainLines.push(line);
    }
  }

  const thought = thoughtLines.join("\n").trim();
  const main = mainLines.join("\n").trim();

  if (!thought) {
    return { thought: null, main: content };
  }
  if (!main) {
    // 避免误判导致正文完全丢失，保留原文本。
    return { thought: null, main: content };
  }
  return { thought, main };
}

function ChatMessageItemBase({ message, minimalMode, labels, isRunning, onRetry, onCopy }: Props) {
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";
  const isSystem = message.role === "system";

  const cleanContent = useMemo(() => stripAnsi(message.content || ""), [message.content]);
  const isCollapsible = isAssistant && message.status !== "streaming" && cleanContent.length > 1400;
  const [expanded, setExpanded] = useState(!isCollapsible);
  const [showThought, setShowThought] = useState(false);

  const renderedAssistantContent = useMemo(() => {
    if (!isAssistant) return "";
    if (expanded || !isCollapsible) return cleanContent;
    return `${cleanContent.slice(0, 900)}\n\n...`;
  }, [cleanContent, expanded, isAssistant, isCollapsible]);

  const extractedThought = useMemo(
    () => (isAssistant ? extractThoughtBlock(renderedAssistantContent) : { thought: null, main: renderedAssistantContent }),
    [isAssistant, renderedAssistantContent],
  );

  if (isSystem) {
    const isTool = message.meta?.eventType === "tool";
    const isError = message.meta?.eventStatus === "error";
    const isDone = message.meta?.eventStatus === "done";
    const Icon = isError ? AlertTriangle : isTool ? Wrench : isDone ? CircleCheck : Sparkles;
    return (
      <div className="flex justify-center p-1">
        <div className="w-full max-w-[760px] rounded-lg border border-border-muted bg-bg-surface px-3 py-2">
          <div className="flex items-center gap-2 text-[10px] uppercase font-semibold text-text-muted">
            <Icon size={12} />
            <span>{message.meta?.toolName || labels.roleSystem}</span>
            {message.meta?.eventStatus && (
              <span
                className={cn(
                  "ml-auto rounded-full px-2 py-0.5 border text-[9px]",
                  isError
                    ? "text-rose-500 border-rose-500/40"
                    : isDone
                      ? "text-emerald-500 border-emerald-500/40"
                      : "text-amber-500 border-amber-500/40",
                )}
              >
                {message.meta.eventStatus}
              </span>
            )}
          </div>
          <div className="mt-1 text-[12px] text-text-main/85">{message.content}</div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group relative flex w-full gap-3 py-2",
        isUser ? "flex-row-reverse" : "flex-row"
      )}
    >
      {/* Avatar */}
      <div className={cn(
        "shrink-0 w-7 h-7 rounded-lg flex items-center justify-center border select-none transition-colors",
        isUser 
          ? "bg-bg-elevated text-primary-500 border-primary-500/20" 
          : "bg-bg-elevated text-text-muted border-border-muted"
      )}>
        {isUser ? <User size={14} /> : isAssistant ? <Bot size={14} /> : <Sparkles size={14} />}
      </div>

      <div className={cn(
        "flex flex-col gap-1 w-full",
        isUser ? "items-end" : "items-start"
      )}>
        {/* Role labels - only if not minimal */}
        {!minimalMode && (
          <span className="text-[10px] font-semibold text-text-muted/40 uppercase px-1">
            {isUser ? labels.roleUser : labels.roleAssistant}
          </span>
        )}

        <div
          className={cn(
            "relative group/bubble p-4 transition-all duration-200",
            isUser
              ? "rounded-2xl rounded-tr-none bg-primary-500 text-white max-w-[85%]"
              : "rounded-2xl rounded-tl-none bg-bg-surface border border-border-muted text-text-main min-w-[60px] max-w-[90%]"
          )}
        >
          {message.attachments && message.attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {message.attachments.map((attachment) => (
                <div key={attachment.path} className={cn(
                  "flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-medium border",
                  isUser ? "bg-white/10 border-white/20 text-white" : "bg-bg-base border-border-muted/30 text-text-muted"
                )}>
                  <span className="w-1 h-1 rounded-full bg-current opacity-50" />
                  {attachment.name}
                </div>
              ))}
            </div>
          )}

          <div className="text-[14px] leading-relaxed">
            {isAssistant && message.status === "streaming" && !message.content.trim() ? (
              <div className="flex items-center py-2">
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary-500 animate-pulse" />
                  <span className="w-1.5 h-1.5 rounded-full bg-primary-500 animate-pulse delay-75" />
                  <span className="w-1.5 h-1.5 rounded-full bg-primary-500 animate-pulse delay-150" />
                </div>
              </div>
            ) : isAssistant ? (
              <>
                {extractedThought.thought && (
                  <div className="mb-2 rounded-md border border-border-muted bg-bg-base/70 px-3 py-2">
                    <button
                      type="button"
                      className="w-full flex items-center justify-between text-left text-[11px] font-semibold text-text-muted"
                      onClick={() => setShowThought((v) => !v)}
                    >
                      <span>{labels.thinking}</span>
                      <span className="text-[10px]">{showThought ? "收起" : "展开"}</span>
                    </button>
                    {showThought && (
                      <div className="mt-2 text-[12px] leading-relaxed whitespace-pre-wrap wrap-break-word text-text-main/85">
                        {extractedThought.thought}
                      </div>
                    )}
                  </div>
                )}
                <ChatMessageContent
                  content={extractedThought.main || labels.noOutputYet}
                  isStreaming={message.status === "streaming"}
                />
                {isCollapsible && (
                  <button
                    type="button"
                    className="mt-2 text-[11px] text-primary-500 hover:text-primary-600 transition-colors"
                    onClick={() => setExpanded((v) => !v)}
                  >
                    {expanded ? labels.collapseResult : labels.expandResult}
                  </button>
                )}
              </>
            ) : (
              <div className="whitespace-pre-wrap wrap-break-word text-[14px] leading-relaxed">{message.content}</div>
            )}
          </div>

          {/* Controls - more discrete */}
          <div className={cn(
            "absolute -bottom-8 opacity-0 group-hover/bubble:opacity-100 transition-opacity",
            isUser ? "right-0" : "left-0"
          )}>
            <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-bg-surface border border-border-muted shadow-lg">
              <button 
                onClick={() => onCopy?.(message.content)}
                className="p-1.5 rounded-md hover:bg-bg-elevated text-text-muted transition-colors"
                title="Copy"
              >
                <Copy size={12} />
              </button>
              {isAssistant && !isRunning && (
                <button 
                  onClick={() => onRetry?.(message.id)}
                  className="p-1.5 rounded-md hover:bg-bg-elevated text-text-muted transition-colors"
                  title="Retry"
                >
                  <RotateCcw size={12} />
                </button>
              )}
              {isAssistant && (
                <>
                  <div className="w-px h-2.5 bg-border-muted mx-0.5" />
                  <button className="p-1.5 rounded-md hover:bg-bg-elevated text-text-muted">
                    <ThumbsUp size={12} />
                  </button>
                  <button className="p-1.5 rounded-md hover:bg-bg-elevated text-text-muted">
                    <ThumbsDown size={12} />
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {isAssistant && message.durationMs && message.status === "done" && (
          <div className="flex gap-2.5 px-1 opacity-40">
            <span className="text-[9px] font-semibold uppercase">
              {(message.durationMs / 1000).toFixed(1)}s
            </span>
            {message.tokenEstimate && (
              <span className="text-[9px] font-semibold uppercase">
                {message.tokenEstimate.approx_output_tokens} tokens
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export const ChatMessageItem = memo(
  ChatMessageItemBase,
  (prev, next) =>
    prev.message === next.message &&
    prev.minimalMode === next.minimalMode &&
    prev.labels === next.labels &&
    prev.isRunning === next.isRunning,
);
