import { memo, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Sparkles,
  AlertTriangle,
  Loader2,
  Terminal,
  FileCode,
  Search,
  Wrench,
  Play,
  RotateCcw,
} from "lucide-react";
import { ChatMessageContent } from "./ChatMessageContent";
import { ThinkingBlock } from "./chat/ThinkingBlock";
import { cn } from "../lib/utils";
import { stripAnsi } from "../lib/utils/terminal";
import type { ChatChoiceOption, ChatMessage } from "../types";
import { useTranslation } from "../i18n";

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
  minimalMode?: boolean;
  isRunning?: boolean;
  onRetry?: (id: string) => void;
  onCopy?: (content: string) => void;
  liveTranscript?: string;
  isHighlighted?: boolean;
  onChoiceSelect?: (message: ChatMessage, option: ChatChoiceOption) => void | Promise<void>;
};

type ThoughtExtractResult = {
  thought: string | null;
  main: string;
};

function extractThoughtBlock(message: ChatMessage, isStreaming: boolean): ThoughtExtractResult {
  // 1. Direct support for message.reasoning (from DeepSeek or other reasoning models)
  if (message.reasoning) {
    return { thought: message.reasoning, main: message.content };
  }

  const content = message.content || "";
  
  // 2. Support for <think>...</think> tags
  const thinkMatch = content.match(/<think>([\s\S]*?)(?:<\/think>|$)/i);
  if (thinkMatch) {
    const thought = thinkMatch[1];
    const main = content.replace(/<think>[\s\S]*?(?:<\/think>|$)/i, "").trim();
    
    // If we only have thought and it's streaming, treat main as empty
    if (isStreaming && !content.includes("</think>")) {
      return { thought, main: "" };
    }
    
    return { thought, main: main || (content.includes("</think>") ? "" : content) };
  }

  // 3. Fallback to heuristic line-based parsing
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

function ChatMessageItemBase({ message, labels, liveTranscript, isHighlighted, onRetry, onChoiceSelect }: Props) {
  const { t } = useTranslation();
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";
  const isSystem = message.role === "system";

  const cleanContent = useMemo(() => stripAnsi(message.content || ""), [message.content]);
  const isCollapsible = isAssistant && message.status !== "streaming" && cleanContent.length > 2000;
  const [expanded, setExpanded] = useState(!isCollapsible);

  const renderedAssistantContent = useMemo(() => {
    if (!isAssistant) return "";
    if (expanded || !isCollapsible) return cleanContent;
    return `${cleanContent.slice(0, 1000)}\n\n...`;
  }, [cleanContent, expanded, isAssistant, isCollapsible]);

  const extractedThought = useMemo(
    () => (isAssistant ? extractThoughtBlock(message, message.status === "streaming") : { thought: null, main: renderedAssistantContent }),
    [isAssistant, message, renderedAssistantContent],
  );

  if (isSystem) {
    const choice = message.meta?.choice;
    if (choice) {
      return (
        <div className="flex justify-center p-2">
          <div className="w-full max-w-[760px] rounded-2xl border border-border-muted/20 bg-bg-surface px-4 py-4 shadow-sm">
            <div className="flex items-center gap-2 text-[10px] uppercase font-bold text-text-muted/60 tracking-wider">
              <Sparkles size={12} className="opacity-60" />
              <span>{t("needs_selection")}</span>
              <span
                className={cn(
                  "ml-auto rounded-full border px-2 py-0.5 text-[9px]",
                  choice.status === "resolved"
                    ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-500"
                    : "border-amber-500/30 bg-amber-500/5 text-amber-500",
                )}
              >
                {choice.status === "resolved" ? t("status_resolved") : t("status_pending")}
              </span>
            </div>

            <div className="mt-3">
              <div className="text-sm font-bold text-text-main">{choice.title}</div>
              {choice.description && (
                <div className="mt-1 text-[12px] leading-relaxed text-text-main/75">
                  {choice.description}
                </div>
              )}
              {message.content && (
                <div className="mt-2 text-[12px] leading-relaxed text-text-muted/70">
                  {message.content}
                </div>
              )}
            </div>

            <div className="mt-4 grid gap-2">
              {choice.options.map((option) => {
                const isSelected = choice.selectedOptionId === option.id;
                const isResolved = choice.status === "resolved";
                const isDestructive = option.variant === "destructive";

                return (
                  <button
                    key={option.id}
                    type="button"
                    disabled={isResolved}
                    onClick={() => void onChoiceSelect?.(message, option)}
                    className={cn(
                      "rounded-xl border px-3 py-3 text-left transition-all",
                      "disabled:cursor-not-allowed disabled:opacity-90",
                      isSelected
                        ? "border-primary/40 bg-primary/8"
                        : isDestructive
                          ? "border-rose-500/20 bg-rose-500/5 hover:border-rose-500/35"
                          : "border-border-muted/20 bg-bg-base/40 hover:border-primary/30 hover:bg-primary/5",
                    )}
                  >
                    <div
                      className={cn(
                        "text-[12px] font-bold",
                        isDestructive ? "text-rose-500" : "text-text-main",
                      )}
                    >
                      {option.label}
                    </div>
                    {option.description && (
                      <div className="mt-1 text-[11px] leading-relaxed text-text-muted/70">
                        {option.description}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      );
    }

    const isError = message.meta?.eventStatus === "error";
    const isDone = message.meta?.eventStatus === "done";
    const isExecuting = message.meta?.eventStatus === "pending" || !message.meta?.eventStatus;

    const toolInput = message.meta?.toolInput;
    const toolOutput = message.meta?.toolOutput;
    const toolName = message.meta?.toolName || "";
    const isWrite = toolName.includes("write");
    const isRead = toolName.includes("read") || toolName.includes("list");
    const isSearch = toolName.includes("search");
    const isRun = toolName.includes("run");

    return (
      <div className="flex justify-center p-1 group/tool">
        <div className={cn(
          "w-full max-w-[760px] rounded-xl border px-3 py-2.5 transition-all duration-300",
          isExecuting ? "border-primary/20 bg-primary/5 shadow-[0_0_20px_rgba(var(--primary-rgb),0.05)]" :
          isError ? "border-rose-500/20 bg-rose-500/5 text-rose-200" :
          "border-border-muted/30 bg-bg-surface shadow-[0_2px_8px_rgba(0,0,0,0.05)] hover:border-primary/20"
        )}>
          <div className="flex items-center gap-3">
            <div className={cn(
              "p-2 rounded-lg shrink-0 transition-transform group-hover/tool:scale-105",
              isExecuting ? "bg-primary/20 text-primary shadow-[0_0_10px_rgba(var(--primary-rgb),0.2)]" :
              isError ? "bg-rose-500/20 text-rose-500" :
              "bg-bg-base border border-border-muted/20 text-primary/60"
            )}>
              {isExecuting ? <Loader2 size={14} className="animate-spin" /> :
               isWrite ? <FileCode size={14} className="text-emerald-500" /> :
               isSearch ? <Search size={14} className="text-sky-500" /> :
               isRun ? <Play size={14} className="text-amber-500" /> :
               isRead ? <FileCode size={14} className="text-primary" /> :
               <Wrench size={14} />}
            </div>

            <div className="flex flex-col min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className={cn(
                  "text-[10px] font-black uppercase tracking-widest",
                  isExecuting ? "text-primary" : "text-text-muted/70"
                )}>
                  {message.meta?.toolName || labels.roleSystem}
                </span>
                <span className="h-0.5 w-0.5 rounded-full bg-text-muted/20" />
                <span className={cn(
                  "text-[9px] font-bold uppercase tracking-tight",
                  isExecuting ? "text-primary/40 animate-pulse" : 
                  isError ? "text-rose-500/60" : "text-emerald-500/60"
                )}>
                  {isExecuting ? t("status_executing") : isError ? t("status_failed") : t("status_success")}
                </span>
              </div>
              <div className="text-[11px] text-text-main/70 leading-relaxed font-mono truncate mt-0.5 flex items-center gap-2">
                {isRun && <Terminal size={10} className="opacity-40" />}
                {message.content || toolInput || (isExecuting ? t("status_initializing") : t("no_detail_available"))}
              </div>
              
              {toolOutput && !isExecuting && (
                <div className="mt-2 text-[10px] p-2 rounded bg-bg-base/50 border border-border-muted/10 font-mono text-text-muted max-h-[100px] overflow-y-auto whitespace-pre-wrap">
                  {toolOutput}
                </div>
              )}
            </div>

            {isDone && (
              <div className="flex items-center gap-2">
                {isError && onRetry && (
                  <button 
                    onClick={() => onRetry(message.id)}
                    className="p-1.5 rounded-md hover:bg-rose-500/10 text-rose-500/40 hover:text-rose-500 transition-all"
                  >
                    <RotateCcw size={12} />
                  </button>
                )}
                <div className="hidden group-hover/tool:flex items-center gap-1.5 px-2 py-1 rounded-md bg-bg-base border border-border-muted/10 text-[9px] font-black text-text-muted/60 uppercase tracking-widest transition-all cursor-pointer hover:text-primary hover:border-primary/20">
                  <Terminal size={10} />
                  {t("details")}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
      className={cn(
        "group relative flex w-full gap-4 py-3 px-6 transition-all duration-400 font-mono text-[12.5px]",
        isAssistant
          ? "bg-bg-surface/2 border-border-muted/2 shadow-primary/5 hover:ring-primary/20"
          : "bg-primary/5 border-primary/20 shadow-primary/5 hover:ring-primary/40",
        isHighlighted && "bg-primary/5 ring-1 ring-primary/20 shadow-[0_0_20px_rgba(var(--primary-rgb),0.1)] z-10 scale-[1.005]"
      )}
    >
      {isHighlighted && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0.4, 0] }}
          transition={{ duration: 2, repeat: 1 }}
          className="absolute inset-0 bg-primary/10 pointer-events-none"
        />
      )}
      {/* Terminal Prompt Prefix */}
      <div className={cn(
        "shrink-0 mt-[4px] select-none font-black tracking-tight flex items-center gap-1",
        isUser ? "text-emerald-500" : isAssistant ? "text-primary font-black" : "text-amber-500"
      )}>
        {isAssistant && message.status === "streaming" && (
           <motion.div 
             animate={{ opacity: [0.3, 1, 0.3] }}
             transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
             className="w-1.5 h-1.5 rounded-full bg-primary shadow-glow" 
           />
        )}
        ❯
      </div>

      <div className="flex flex-col w-full min-w-0 font-sans">
        <div className="relative group/bubble p-0 transition-all duration-200 w-full text-text-main">
          {message.attachments && message.attachments.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-3">
              {message.attachments.map((attachment) => (
                <div key={attachment.path} className="group/att relative">
                  {attachment.mime_type?.startsWith("image/") && attachment.data ? (
                    <div className="relative max-w-[240px] max-h-[240px] rounded-2xl overflow-hidden border border-border-muted/10 shadow-sm transition-all hover:shadow-md hover:border-primary/20 bg-bg-base/40">
                      <img 
                        src={`data:${attachment.mime_type};base64,${attachment.data}`} 
                        alt={attachment.name}
                        className="w-full h-full object-contain cursor-zoom-in transition-transform group-hover/att:scale-105"
                      />
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] font-bold border bg-bg-base/40 border-border-muted/30 text-text-muted transition-all hover:bg-primary/5 hover:border-primary/20">
                      <span className="w-1 h-1 rounded-full bg-current opacity-40" />
                      {attachment.name}
                    </div>
                  )}
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
              <div className="flex flex-col gap-2 p-3 border border-rose-500/20 text-rose-400 text-[11px] font-bold rounded-xl bg-rose-500/5 backdrop-blur-sm">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={14} className="text-rose-500" />
                  <span>{t("err_execution_check_logs")}</span>
                </div>
                {onRetry && (
                  <button
                    onClick={() => onRetry(message.id)}
                    className="mt-1 flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 border border-rose-500/20 transition-all font-black uppercase tracking-widest text-[9px]"
                  >
                    <RotateCcw size={12} />
                    {t("diagnose_and_fix")}
                  </button>
                )}
              </div>
            ) : isAssistant ? (
              <>
                {extractedThought.thought && (
                  <ThinkingBlock
                    content={extractedThought.thought}
                    isStreaming={message.status === "streaming" && !cleanContent.includes("</think>")}
                    label={labels.thinking}
                  />
                )}
                {extractedThought.main && (
                  <ChatMessageContent
                    actualContent={extractedThought.main}
                    thinking={extractedThought.thought || ""}
                    isStreaming={message.status === "streaming"}
                  />
                )}
                {!extractedThought.main && extractedThought.thought && message.status === "streaming" && !cleanContent.includes("</think>") && (
                  <div className="text-[11px] text-text-muted/40 italic flex items-center gap-2 mt-2 px-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary/20 animate-pulse" />
                    {t("deep_inference")}
                  </div>
                )}
                {!extractedThought.main && !extractedThought.thought && (
                  <ChatMessageContent
                    actualContent={labels.noOutputYet}
                    isStreaming={message.status === "streaming"}
                  />
                )}
                {isCollapsible && (
                  <button
                    type="button"
                    className="mt-2 text-[10px] font-bold uppercase tracking-wider text-primary/60 hover:text-primary transition-colors"
                    onClick={() => setExpanded((v) => !v)}
                  >
                    {expanded ? labels.collapseResult : labels.expandResult}
                  </button>
                )}
              </>
            ) : (
              <div className="whitespace-pre-wrap wrap-break-word font-medium text-[13px]">{message.content}</div>
            )}
          </div>
        </div>

        {isAssistant && message.status === "done" && (
          <div className="flex items-center gap-4 px-1 opacity-20 mt-1.5 transition-opacity group-hover:opacity-60 select-none border-t border-border-muted/5 pt-1.5">
            {message.durationMs && (
              <div className="flex items-center gap-1.5">
                <div className="w-1 h-1 rounded-full bg-text-muted/40" />
                <span className="text-[9px] font-black tracking-widest uppercase">
                  {(message.durationMs / 1000).toFixed(1)}s
                </span>
              </div>
            )}
            
            {(message.tokenEstimate || message.meta?.usage) && (
              <div className="flex items-center gap-1.5">
                <div className="w-1 h-1 rounded-full bg-text-muted/40" />
                <span className="text-[9px] font-black tracking-widest uppercase">
                  {message.meta?.usage ? (
                    `${message.meta.usage.total_tokens} tokens`
                  ) : (
                    `${message.tokenEstimate?.approx_output_tokens} tokens`
                  )}
                </span>
                {message.meta?.usage && (
                   <span className="text-[8px] font-bold text-emerald-500/50">
                     ${((message.meta.usage.total_tokens / 1000000) * 0.15).toFixed(4)}
                   </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

export const ChatMessageItem = memo(
  ChatMessageItemBase,
  (prev, next) =>
    prev.message === next.message &&
    prev.labels === next.labels &&
    prev.isRunning === next.isRunning &&
    prev.liveTranscript === next.liveTranscript &&
    prev.onChoiceSelect === next.onChoiceSelect,
);
