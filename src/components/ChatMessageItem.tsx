import { memo, useMemo, useState } from "react";
import {
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
  labels: Labels;
  isRunning?: boolean;
  liveTranscript?: string;
};

type ThoughtExtractResult = {
  thought: string | null;
  main: string;
};

function extractThoughtBlock(content: string, isStreaming: boolean): ThoughtExtractResult {
  // Support for <think>...</think> tags
  const thinkMatch = content.match(/<think>([\s\S]*?)(?:<\/think>|$)/i);
  if (thinkMatch) {
    const thought = thinkMatch[1].trim();
    const main = content.replace(/<think>[\s\S]*?(?:<\/think>|$)/i, "").trim();
    if (!thought) return { thought: null, main: content };
    if (!main && !content.includes("</think>")) {
      return { thought, main: "" };
    }
    return { thought, main: main || content };
  }

  // Fallback to heuristic line-based parsing
  const lines = content.split("\n");
  const thoughtLines: string[] = [];
  const mainLines: string[] = [];
  let inThought = false;
  let hasFoundMain = false;

  const thoughtStartRe = /^\s*(?:#{1,6}\s*)?(?:thinking|thought|analysis|plan|思考|推理|分析|计划|步骤)\s*[:：]?\s*$/i;
  const thoughtBlockStartRe = /^\s*```(?:thought|thinking|思考)\s*$/i;
  const answerStartRe = /^\s*(?:#{1,6}\s*)?(?:final|answer|result|结论|结果|回复|回答)\s*[:：]?\s*$/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inThought && !hasFoundMain && (thoughtStartRe.test(line) || thoughtBlockStartRe.test(line))) {
      inThought = true;
      continue;
    }
    if (inThought) {
      if (answerStartRe.test(line) || line.trim() === "```") {
        inThought = false;
        hasFoundMain = true;
        continue;
      }
      thoughtLines.push(line);
    } else {
      mainLines.push(line);
      if (line.trim().length > 0) {
         hasFoundMain = true;
      }
    }
  }

  const thought = thoughtLines.join("\n").trim();
  const main = mainLines.join("\n").trim();
  if (!thought) return { thought: null, main: content };
  if (!main) {
    if (isStreaming) return { thought, main: "" };
    return { thought: null, main: content };
  }
  return { thought, main };
}

function ChatMessageItemBase({ message, labels, liveTranscript }: Props) {
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";
  const isSystem = message.role === "system";

  const cleanContent = useMemo(() => stripAnsi(message.content || ""), [message.content]);
  const isCollapsible = isAssistant && message.status !== "streaming" && cleanContent.length > 2000;
  const [expanded] = useState(!isCollapsible);
  const [showThought, setShowThought] = useState(false);

  const renderedAssistantContent = useMemo(() => {
    if (!isAssistant) return "";
    if (expanded || !isCollapsible) return cleanContent;
    return `${cleanContent.slice(0, 1000)}\n\n...`;
  }, [cleanContent, expanded, isAssistant, isCollapsible]);

  const extractedThought = useMemo(
    () => (isAssistant ? extractThoughtBlock(renderedAssistantContent, message.status === "streaming") : { thought: null, main: renderedAssistantContent }),
    [isAssistant, renderedAssistantContent, message.status],
  );

  if (isSystem) {
    const isTool = message.meta?.eventType === "tool";
    const isError = message.meta?.eventStatus === "error";
    const isDone = message.meta?.eventStatus === "done";
    const Icon = isError ? AlertTriangle : isTool ? Wrench : isDone ? CircleCheck : Sparkles;
    return (
      <div className="flex justify-center p-1">
        <div className="w-full max-w-[760px] rounded-lg border border-border-muted bg-bg-surface px-3 py-2 shadow-sm">
          <div className="flex items-center gap-2 text-[10px] uppercase font-bold text-text-muted/60 tracking-wider">
            <Icon size={12} className="opacity-60" />
            <span>{message.meta?.toolName || labels.roleSystem}</span>
            {message.meta?.eventStatus && (
              <span
                className={cn(
                  "ml-auto rounded-full px-2 py-0.5 border text-[9px]",
                  isError ? "text-rose-500 border-rose-500/30 bg-rose-500/5" : isDone ? "text-emerald-500 border-emerald-500/30 bg-emerald-500/5" : "text-amber-500 border-amber-500/30 bg-amber-500/5",
                )}
              >
                {message.meta.eventStatus}
              </span>
            )}
          </div>
          <div className="mt-1 text-[12px] text-text-main/80 leading-relaxed">{message.content}</div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group relative flex w-full gap-3 py-1 px-5 transition-colors font-mono text-[12px] hover:bg-bg-subtle/5",
        isUser ? "bg-transparent" : "bg-transparent"
      )}
    >
      {/* Terminal Prompt Prefix */}
      <div className={cn(
        "shrink-0 mt-[2px] select-none font-black tracking-tight",
        isUser ? "text-emerald-500" : isAssistant ? "text-primary/70 font-bold" : "text-amber-500"
      )}>
        ❯
      </div>

      <div className="flex flex-col w-full min-w-0 font-sans">
        <div className="relative group/bubble p-0 transition-all duration-200 w-full text-text-main">
          {message.attachments && message.attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {message.attachments.map((attachment) => (
                <div key={attachment.path} className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-bold border bg-bg-base/40 border-border-muted/30 text-text-muted">
                  <span className="w-1 h-1 rounded-full bg-current opacity-40" />
                  {attachment.name}
                </div>
              ))}
            </div>
          )}

          <div className="leading-[1.6]">
            {isAssistant && message.status === "streaming" && !message.content.trim() ? (
              <div className="leading-[1.4] whitespace-pre-wrap break-all text-text-muted tracking-tight min-h-[20px]">
                {liveTranscript || ""}
                <span className="inline-block w-2 h-3.5 ml-1 bg-text-muted animate-pulse align-text-bottom opacity-50" />
              </div>
            ) : isAssistant && message.status === "error" && !message.content.trim() ? (
              <div className="flex items-center gap-2 py-2 px-3 border border-rose-500/10 text-rose-500 text-[11px] font-bold rounded-lg bg-rose-500/5">
                <AlertTriangle size={14} />
                <span>Execution error. Check logs.</span>
              </div>
            ) : isAssistant ? (
              <>
                {extractedThought.thought && (
                  <div className="mb-2 rounded-xl border border-border-muted/20 bg-bg-surface/30 p-4 animate-in fade-in duration-300 shadow-sm">
                    <button
                      type="button"
                      className="flex items-center gap-2 w-full text-left text-[10px] font-black tracking-[0.2em] uppercase text-text-muted/40 hover:text-text-muted transition-colors"
                      onClick={() => setShowThought((v) => !v)}
                    >
                      <Sparkles size={12} className="text-primary/40" />
                      <span>{labels.thinking}</span>
                      <span className="ml-auto text-[8px] opacity-40">{showThought ? "COLLAPSE" : "EXPAND"}</span>
                    </button>
                    {showThought && (
                      <div className="mt-2 text-[11px] leading-normal text-text-muted/70 border-l-2 border-primary/10 pl-4 py-1 font-mono italic">
                        {extractedThought.thought}
                      </div>
                    )}
                  </div>
                )}
                {extractedThought.main && (
                  <ChatMessageContent
                    content={extractedThought.main}
                    isStreaming={message.status === "streaming"}
                  />
                )}
                {!extractedThought.main && extractedThought.thought && message.status === "streaming" && (
                  <div className="text-[11px] text-text-muted/40 italic flex items-center gap-2 mt-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary/20 animate-pulse" />
                    Thinking...
                  </div>
                )}
                {!extractedThought.main && !extractedThought.thought && (
                  <ChatMessageContent
                    content={labels.noOutputYet}
                    isStreaming={message.status === "streaming"}
                  />
                )}
              </>
            ) : (
              <div className="whitespace-pre-wrap wrap-break-word font-medium text-[13px]">{message.content}</div>
            )}
          </div>
        </div>

        {isAssistant && message.durationMs && message.status === "done" && (
          <div className="flex gap-3 px-1 opacity-20 mt-1 transition-opacity group-hover:opacity-40 select-none">
            <span className="text-[9px] font-black tracking-widest uppercase">{(message.durationMs / 1000).toFixed(1)}s</span>
            {message.tokenEstimate && (
              <span className="text-[9px] font-black tracking-widest uppercase">{message.tokenEstimate.approx_output_tokens} tokens</span>
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
    prev.labels === next.labels &&
    prev.isRunning === next.isRunning &&
    prev.liveTranscript === next.liveTranscript,
);
