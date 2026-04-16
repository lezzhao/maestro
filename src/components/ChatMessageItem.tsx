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
  Lightbulb,
  Check,
} from "lucide-react";
import { useChatStore } from "../stores/chat";
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
  const saveSkill = useChatStore(s => s.saveSkill);
  const [isSavingSkill, setIsSavingSkill] = useState(false);
  const [hasSavedSkill, setHasSavedSkill] = useState(false);

  const handleSaveSkill = async () => {
    if (isSavingSkill || hasSavedSkill) return;
    setIsSavingSkill(true);
    try {
      // Auto-extracting info from current message for simplicity in this interaction
      // A more complex version would show a dialog.
      const name = message.content.split("\n")[0].slice(0, 30) || "New Skill";
      const description = `Skill learned from conversation: ${message.content.slice(0, 100)}...`;
      await saveSkill(name, description, message.content);
      setHasSavedSkill(true);
    } catch (e) {
      // Error handled by store toast
    } finally {
      setIsSavingSkill(false);
    }
  };
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
        <div className="flex justify-center p-3 animate-fade-up duration-500">
          <div className="w-full max-w-[760px] rounded-2xl border border-border bg-card px-6 py-6 shadow-sm">
            <div className="flex items-center gap-2.5 text-[10px] uppercase font-bold text-muted-foreground/50 tracking-[0.15em]">
              <Sparkles size={14} className="opacity-60 text-primary" />
              <span>{t("needs_selection")}</span>
              <span
                className={cn(
                  "ml-auto rounded-full border px-2.5 py-0.5 text-[9px] font-bold tracking-tight",
                  choice.status === "resolved"
                    ? "border-primary/30 bg-primary/5 text-primary"
                    : "border-amber-500/30 bg-amber-500/5 text-amber-500",
                )}
              >
                {choice.status === "resolved" ? t("status_resolved") : t("status_pending")}
              </span>
            </div>

            <div className="mt-4">
              <div className="text-[15px] font-bold text-foreground tracking-tight">{choice.title}</div>
              {choice.description && (
                <div className="mt-2 text-[13px] leading-relaxed text-muted-foreground font-medium">
                  {choice.description}
                </div>
              )}
              {message.content && (
                <div className="mt-3 text-[13px] leading-relaxed text-muted-foreground/70 font-medium">
                  {message.content}
                </div>
              )}
            </div>

            <div className="mt-6 grid gap-2.5">
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
                      "rounded-xl border px-4 py-4 text-left transition-all duration-300",
                      "disabled:cursor-not-allowed",
                      isSelected
                        ? "border-primary/40 bg-primary/5 ring-1 ring-primary/20"
                        : isDestructive
                          ? "border-destructive/20 bg-destructive/5 hover:border-destructive/40"
                          : "border-border/40 bg-muted/20 hover:border-primary/30 hover:bg-primary/5 hover:shadow-sm",
                    )}
                  >
                    <div
                      className={cn(
                        "text-[13px] font-bold",
                        isDestructive ? "text-destructive" : "text-foreground",
                      )}
                    >
                      {option.label}
                    </div>
                    {option.description && (
                      <div className="mt-1.5 text-[11px] font-medium leading-relaxed text-muted-foreground/60">
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
      <div className="flex justify-center p-1.5 group/tool animate-in fade-in zoom-in-95 duration-300">
        <div className={cn(
          "w-full max-w-[760px] rounded-xl border px-4 py-3 transition-all duration-500",
          isExecuting ? "border-primary/30 bg-primary/5 shadow-lg shadow-primary/5" :
          isError ? "border-destructive/30 bg-destructive/5" :
          "border-border bg-card shadow-sm hover:border-primary/20 hover:shadow-md"
        )}>
          <div className="flex items-center gap-4">
            <div className={cn(
              "w-9 h-9 rounded-xl shrink-0 flex items-center justify-center transition-all group-hover/tool:scale-105 duration-300",
              isExecuting ? "bg-primary/20 text-primary animate-pulse" :
              isError ? "bg-destructive/20 text-destructive" :
              "bg-muted border border-border text-primary/70"
            )}>
              {isExecuting ? <Loader2 size={16} className="animate-spin" /> :
               isWrite ? <FileCode size={16} /> :
               isSearch ? <Search size={16} /> :
               isRun ? <Play size={16} /> :
               isRead ? <FileCode size={16} /> :
               <Wrench size={16} />}
            </div>

            <div className="flex flex-col min-w-0 flex-1">
              <div className="flex items-center gap-2.5">
                <span className={cn(
                  "text-[10px] font-bold uppercase tracking-[0.15em]",
                  isExecuting ? "text-primary" : "text-muted-foreground/60"
                )}>
                  {message.meta?.toolName || labels.roleSystem}
                </span>
                <span className="h-0.5 w-0.5 rounded-full bg-border" />
                <span className={cn(
                  "text-[9px] font-bold uppercase tracking-[0.05em]",
                  isExecuting ? "text-primary/60 animate-pulse" : 
                  isError ? "text-destructive/60" : "text-emerald-500/60"
                )}>
                  {isExecuting ? t("status_executing") : isError ? t("status_failed") : t("status_success")}
                </span>
              </div>
              <div className="text-[12px] text-foreground/80 leading-relaxed font-mono truncate mt-0.5 flex items-center gap-2">
                {isRun && <Terminal size={12} className="opacity-40" />}
                {message.content || toolInput || (isExecuting ? t("status_initializing") : t("no_detail_available"))}
              </div>
              
              {toolOutput && !isExecuting && (
                <div className="mt-3 text-[11px] p-3 rounded-lg bg-muted/40 border border-border/10 font-mono text-muted-foreground/80 max-h-[150px] overflow-y-auto no-scrollbar whitespace-pre-wrap leading-relaxed">
                  {toolOutput}
                </div>
              )}
            </div>

            {isDone && (
              <div className="flex items-center gap-3">
                {isError && onRetry && (
                  <button 
                    onClick={() => onRetry(message.id)}
                    className="p-2 rounded-lg bg-destructive/10 text-destructive hover:bg-destructive hover:text-destructive-foreground transition-all duration-300"
                    title="Retry"
                  >
                    <RotateCcw size={14} />
                  </button>
                )}
                <div className="hidden group-hover/tool:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted border border-border text-[10px] font-bold text-muted-foreground/60 uppercase tracking-widest transition-all cursor-pointer hover:text-primary hover:border-primary/20 hover:shadow-sm">
                  <Terminal size={12} />
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
      transition={{ duration: 0.4, ease: [0.24, 1, 0.32, 1] }}
      className={cn(
        "group relative flex w-full gap-5 py-5 px-8 transition-all duration-400 font-sans",
        isAssistant
          ? "bg-transparent border-transparent"
          : "bg-primary/[0.03] border-y border-primary/5",
        isHighlighted && "bg-primary/[0.05] ring-1 ring-primary/10 shadow-lg shadow-primary/5 z-10"
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
        "shrink-0 mt-[2px] select-none font-black tracking-tight flex items-center gap-1.5",
        isUser ? "text-primary/60" : isAssistant ? "text-primary" : "text-amber-500"
      )}>
        {isAssistant && message.status === "streaming" && (
           <motion.div 
             animate={{ scale: [1, 1.3, 1], opacity: [0.4, 1, 0.4] }}
             transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
             className="w-2 h-2 rounded-full bg-primary shadow-[0_0_10px_hsla(var(--primary),0.5)]" 
           />
        )}
        <span className="text-[14px]">❯</span>
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
          <div className="flex items-center gap-5 px-0 opacity-0 mt-3 transition-opacity group-hover:opacity-40 select-none border-t border-border/20 pt-3">
            {message.durationMs && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold tracking-widest uppercase">
                  {(message.durationMs / 1000).toFixed(1)}s
                </span>
              </div>
            )}
            
            {(message.tokenEstimate || message.meta?.usage) && (
              <div className="flex items-center gap-5">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold tracking-widest uppercase text-foreground">
                    {message.meta?.usage ? (
                      `${message.meta.usage.total_tokens} tokens`
                    ) : (
                      `${message.tokenEstimate?.approx_output_tokens} tokens`
                    )}
                  </span>
                </div>
                {message.meta?.usage && (
                   <span className="text-[9px] font-bold text-primary/80 tracking-tight">
                     Cost: ${((message.meta.usage.total_tokens / 1000000) * 0.15).toFixed(5)}
                   </span>
                )}
              </div>
            )}

            <button
              onClick={handleSaveSkill}
              disabled={isSavingSkill || hasSavedSkill}
              className={cn(
                "ml-auto flex items-center gap-2 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest transition-all",
                hasSavedSkill 
                  ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
                  : "bg-primary/10 text-primary hover:bg-primary/20 border border-transparent hover:border-primary/30"
              )}
            >
              {isSavingSkill ? (
                <Loader2 size={10} className="animate-spin" />
              ) : hasSavedSkill ? (
                <Check size={10} />
              ) : (
                <Lightbulb size={10} />
              )}
              {hasSavedSkill ? t("status_success") : t("save_as_skill")}
            </button>
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
