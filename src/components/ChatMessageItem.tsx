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
import { Button } from "./ui/button";
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
  taskId: string | null;
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

function ChatMessageItemBase({ message, labels, taskId, liveTranscript, isHighlighted, onRetry, onCopy, onChoiceSelect }: Props) {
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
        <div className="flex flex-col w-full py-4 px-6 animate-in fade-in duration-300">
          <div className="flex flex-col gap-4 w-full">
            <div className="flex items-center gap-3">
              <span className="text-[14px] font-bold text-foreground font-mono">
                {choice.title}
              </span>
              <span className={cn(
                "text-[10px] font-mono px-2 py-0.5 rounded",
                choice.status === "resolved"
                  ? "text-emerald-500 bg-emerald-500/10 border border-emerald-500/20"
                  : "text-amber-500 bg-amber-500/10 border border-amber-500/20 animate-pulse",
              )}>
                {choice.status === "resolved" ? "RESOLVED" : "ACTION REQUIRED"}
              </span>
            </div>
            
            {choice.description && (
              <p className="text-[13px] text-muted-foreground font-mono max-w-2xl leading-relaxed">
                {choice.description}
              </p>
            )}

            <div className="grid gap-2 max-w-xl mt-2">
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
                      "flex flex-col gap-1 px-4 py-2 text-left rounded-md transition-all duration-100 font-mono text-[13px]",
                      "disabled:cursor-not-allowed",
                      isSelected
                        ? "bg-primary/20 text-primary border border-primary/40"
                        : isDestructive
                          ? "bg-destructive/10 text-destructive border border-destructive/20 hover:bg-destructive/20"
                          : "bg-muted/30 text-muted-foreground border border-border/40 hover:bg-muted/50 hover:text-foreground hover:border-border",
                    )}
                  >
                    <div className="font-bold flex items-center gap-2 text-[12px]">
                      {isSelected ? "❯" : "·"} {option.label}
                    </div>
                    {option.description && (
                      <div className="text-[11px] opacity-60 ml-4">
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
    const isNotice = message.meta?.eventType === "notice";
    const isExecuting = !isNotice && (message.meta?.eventStatus === "pending" || !message.meta?.eventStatus);
    const toolName = message.meta?.toolName || "";

    if (isNotice) {
      return (
        <div className="flex w-full py-0.5 px-6 font-mono opacity-30 group-hover:opacity-100 transition-opacity animate-in fade-in slide-in-from-left-1 duration-500">
          <div className="flex items-center gap-2 text-[9px] tracking-tight">
            <span className="shrink-0 text-primary/60">▗</span>
            <span className="truncate uppercase font-black tracking-[0.2em] text-foreground/50">
              {message.content}
            </span>
            <span className="shrink-0 text-primary/20">▖</span>
          </div>
        </div>
      );
    }

    return (
      <div className="flex w-full py-1 px-6 font-mono group/tool animate-in fade-in duration-300">
        <div className="flex items-center gap-4 w-full text-[13px]">
           <span className={cn(
             "shrink-0 font-bold",
             isExecuting ? "text-primary flex items-center gap-2" : 
             isError ? "text-destructive" : "text-emerald-500"
           )}>
             {isExecuting ? <span className="animate-spin inline-block">◌</span> : 
              isError ? "✖" : "✔"}
           </span>
           
           <div className="flex items-center gap-3 truncate min-w-0">
             <span className={cn(
               "font-black uppercase tracking-wider text-[11px]",
               isExecuting ? "text-primary" : "text-muted-foreground/40"
             )}>
               {toolName || labels.roleSystem}
             </span>
             <span className="text-muted-foreground/30 text-[10px]">::</span>
             <span className="text-foreground/60 truncate italic text-[12px]">
               {message.content || message.meta?.toolInput || "initializing..."}
             </span>
           </div>

           {isDone && isError && onRetry && (
             <button 
               onClick={() => onRetry(message.id)}
               className="ml-4 p-1 rounded hover:bg-destructive/10 text-destructive transition-colors"
             >
               <RotateCcw size={12} />
             </button>
           )}
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={cn(
        "group relative flex w-full flex-col py-0.5 px-6 transition-all duration-200",
        isHighlighted && "bg-primary/[0.05]"
      )}
    >
      <div className="flex flex-col w-full min-w-0">
        <div className="relative p-0 transition-all duration-200 w-full text-foreground/90 terminal-flow">
          {message.attachments && message.attachments.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-3">
              {message.attachments.map((attachment) => (
                <div key={attachment.path} className="group/att relative">
                  {attachment.mime_type?.startsWith("image/") && attachment.data ? (
                    <div className="relative max-w-[240px] rounded border border-border/60 bg-muted/20">
                      <img 
                        src={`data:${attachment.mime_type};base64,${attachment.data}`} 
                        alt={attachment.name}
                        className="w-full h-full object-contain"
                      />
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 px-3 py-1 rounded border border-border/40 bg-muted/20 text-[11px] font-mono text-muted-foreground hover:bg-primary/5 hover:border-primary/20 transition-all">
                      <FileCode size={12} />
                      {attachment.name}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className={cn("leading-normal", isUser && "flex items-start gap-3")}>
            {isUser && <span className="text-primary mt-[3px] select-none flex-shrink-0 font-mono font-black text-[14px]">❯</span>}
            {isAssistant && message.status === "streaming" && !message.content.trim() ? (
              <div className="flex items-center text-muted-foreground font-mono italic text-[12px] opacity-70">
                {liveTranscript || "synthesizing content..."}
                <span className="ml-2 w-1.5 h-3 bg-primary/40 animate-pulse" />
              </div>
            ) : isAssistant && message.status === "error" && !message.content.trim() ? (
              <div className="flex flex-col gap-2 p-3 border border-destructive/20 text-destructive text-[11px] font-mono rounded bg-destructive/5 my-2">
                <div className="flex items-center gap-2 font-black uppercase tracking-widest text-[10px]">
                  <AlertTriangle size={12} />
                  <span>[EXECUTION_FAULT]</span>
                </div>
                <div className="text-[12px] opacity-80 leading-relaxed italic">
                  Check diagnostic logs or retry connection.
                </div>
                {onRetry && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onRetry(message.id)}
                    className="h-7 w-fit text-[11px] font-bold text-destructive hover:bg-destructive/10"
                  >
                    <RotateCcw size={12} className="mr-2" />
                    RETRY EXECUTION
                  </Button>
                )}
              </div>
            ) : isAssistant ? (
              <div className="space-y-4">
                {extractedThought.thought && (
                  <ThinkingBlock
                    content={extractedThought.thought}
                    isStreaming={message.status === "streaming" && !cleanContent.includes("</think>")}
                    label={labels.thinking}
                  />
                )}
                {extractedThought.main && (
                  <ChatMessageContent
                    taskId={taskId}
                    actualContent={extractedThought.main}
                    isStreaming={message.status === "streaming"}
                    className="font-mono text-[13px]"
                  />
                )}
              </div>
            ) : (
              <div className="whitespace-pre-wrap break-all font-mono text-[14px] font-bold tracking-tight">
                {message.content}
              </div>
            )}
          </div>
        </div>

        {/* Minimalist Action Toolbar (Bottom Right) */}
        {isAssistant && message.status === "done" && (
          <div className="flex items-center gap-4 mt-4 opacity-0 group-hover:opacity-100 transition-opacity">
             <div className="flex items-center gap-4 text-[10px] font-mono text-muted-foreground/40 font-bold">
               {message.durationMs && (
                 <span className="tabular-nums">
                   EXEC: {(message.durationMs / 1000).toFixed(2)}s
                 </span>
               )}
               <span className="hidden md:inline">ID: {message.id.slice(0, 8)}</span>
             </div>
             
             <div className="ml-auto flex items-center gap-2">
               <button
                 onClick={handleSaveSkill}
                 disabled={isSavingSkill || hasSavedSkill}
                 className={cn(
                   "px-2 py-0.5 rounded text-[10px] font-mono font-bold transition-all border",
                   hasSavedSkill 
                     ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                     : "bg-muted/30 border-border/40 hover:border-primary/40 hover:text-primary text-muted-foreground/60"
                 )}
               >
                 {hasSavedSkill ? "SKILL_SAVED" : "SAVE_AS_SKILL"}
               </button>
               <button
                 onClick={() => onCopy?.(message.content)}
                 className="p-1 rounded bg-muted/30 border border-border/40 hover:border-primary/40 hover:text-primary text-muted-foreground/60 transition-all"
               >
                 <Check size={12} />
               </button>
             </div>
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
