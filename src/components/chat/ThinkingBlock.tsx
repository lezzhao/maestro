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
    <div className="my-1 group/think">
      <div 
        className={cn(
          "rounded-sm transition-all duration-300 overflow-hidden",
          isStreaming 
            ? "border-l-2 border-primary/40 bg-primary/[0.02]" 
            : "border-l-2 border-border/20"
        )}
      >
        {/* Header */}
        <button
          onClick={() => !isStreaming && setIsExpanded(!isExpanded)}
          disabled={isStreaming}
          className={cn(
            "w-full flex items-center justify-between px-3 py-1 text-left transition-colors font-mono",
            isStreaming ? "cursor-default" : "cursor-pointer hover:bg-muted/30"
          )}
        >
          <div className="flex items-center gap-2">
            <span className={cn(
              "text-[12px] font-bold",
              isStreaming ? "text-primary animate-pulse" : "text-muted-foreground/40"
            )}>
              {isExpanded ? "▼" : "▶"}
            </span>
            <span className={cn(
              "text-[9px] font-black uppercase tracking-widest",
              isStreaming ? "text-primary" : "text-muted-foreground/30"
            )}>
              {isStreaming ? "SYSTEM_DIAGNOSTICS" : `[${defaultLabel.toUpperCase()}]`}
            </span>
          </div>

          {!isStreaming && (
            <div className="text-[10px] font-mono text-muted-foreground/20 italic">
              {isExpanded ? "collapse" : "expand"}
            </div>
          )}
        </button>

        {/* Content */}
        <AnimatePresence initial={false}>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <div className="px-3 pb-3 pt-1">
                <div className="relative pl-3 border-l border-primary/20 font-mono">
                  <div className="text-[12px] leading-relaxed text-muted-foreground/70 italic space-y-1">
                    {content.split("\n\n").map((para, i) => (
                      <p key={i}>
                        {para}
                      </p>
                    ))}
                    {isStreaming && (
                      <span className="inline-block w-1.5 h-3 ml-1 bg-primary/40 animate-pulse" />
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
