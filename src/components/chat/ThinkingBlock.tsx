import { useState, useMemo, memo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, BrainCircuit } from "lucide-react";
import { cn } from "../../lib/utils";
import { useTranslation } from "../../i18n";

interface ThinkingBlockProps {
  content: string;
  isStreaming: boolean;
  label?: string;
}

export const ThinkingBlock = memo(function ThinkingBlock({
  content,
  isStreaming,
  label,
}: ThinkingBlockProps) {
  const { t } = useTranslation();
  const defaultLabel = label || t("reasoning_process");
  const [isExpanded, setIsExpanded] = useState(isStreaming);

  // Auto-expand during streaming
  useMemo(() => {
    if (isStreaming) {
      setIsExpanded(true);
    }
  }, [isStreaming]);

  return (
    <div className="my-5 group/think">
      <div 
        className={cn(
          "rounded-2xl transition-all duration-700 overflow-hidden inner-border shadow-sm",
          isStreaming 
            ? "border-primary/30 bg-primary/[0.04] shadow-[0_0_20px_rgba(var(--primary-rgb),0.1)]" 
            : "glass-surface-low"
        )}
      >
        {/* Header */}
        <button
          onClick={() => !isStreaming && setIsExpanded(!isExpanded)}
          disabled={isStreaming}
          className={cn(
            "w-full flex items-center justify-between px-5 py-3.5 text-left transition-colors",
            isStreaming ? "cursor-default" : "cursor-pointer"
          )}
        >
          <div className="flex items-center gap-4">
            <div className="relative">
              {isStreaming ? (
                <motion.div
                  animate={{ 
                    scale: [1, 1.1, 1],
                    opacity: [0.6, 1, 0.6]
                  }}
                  transition={{ 
                    duration: 2,
                    repeat: Infinity,
                    ease: "easeInOut"
                  }}
                  className="p-1.5 rounded-lg bg-primary/10 text-primary"
                >
                  <BrainCircuit size={16} />
                </motion.div>
              ) : (
                <div className="p-1.5 rounded-lg bg-background border border-border text-muted-foreground/60">
                  <BrainCircuit size={16} />
                </div>
              )}
            </div>
            
            <div className="flex flex-col">
              <span className={cn(
                "text-[10px] font-bold uppercase tracking-[0.15em]",
                isStreaming ? "text-primary" : "text-muted-foreground/40"
              )}>
                {isStreaming ? t("thought_synthesizing") : defaultLabel}
              </span>
              {isStreaming && (
                <span className="text-[9px] text-primary/40 font-medium">
                  Refining architectural context
                </span>
              )}
            </div>
          </div>

          {!isStreaming && (
            <motion.div
              animate={{ rotate: isExpanded ? 180 : 0 }}
              className="text-muted-foreground/30"
            >
              <ChevronDown size={14} />
            </motion.div>
          )}
        </button>

        {/* Content */}
        <AnimatePresence initial={false}>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.4, ease: [0.24, 1, 0.32, 1] }}
            >
              <div className="px-6 pb-6 pt-1">
                <div className="relative">
                  {/* Vertical line indicator */}
                  <div className="absolute left-0 top-0 bottom-0 w-[2px] rounded-full bg-gradient-to-b from-primary/30 via-primary/10 to-transparent" />
                  
                  <div className="pl-6 text-[13px] leading-relaxed text-muted-foreground/80 font-medium italic space-y-3">
                    {content.split("\n\n").map((para, i) => (
                      <p key={i} className="animate-in fade-in slide-in-from-left-1 duration-700" style={{ animationDelay: `${i * 150}ms` }}>
                        {para}
                      </p>
                    ))}
                    {isStreaming && (
                      <span className="inline-block w-1.5 h-3.5 ml-1 bg-primary/30 animate-pulse rounded-full align-middle" />
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
});
