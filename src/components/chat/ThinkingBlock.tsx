import { useState, useMemo, memo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, BrainCircuit } from "lucide-react";
import { cn } from "../../lib/utils";

interface ThinkingBlockProps {
  content: string;
  isStreaming: boolean;
  label?: string;
}

export const ThinkingBlock = memo(function ThinkingBlock({
  content,
  isStreaming,
  label = "Reasoning Process",
}: ThinkingBlockProps) {
  const [isExpanded, setIsExpanded] = useState(isStreaming);

  // Auto-expand during streaming
  useMemo(() => {
    if (isStreaming) {
      setIsExpanded(true);
    }
  }, [isStreaming]);

  return (
    <div className="my-3 group/think">
      <div 
        className={cn(
          "rounded-2xl border transition-all duration-700 overflow-hidden backdrop-blur-2xl",
          isStreaming 
            ? "border-primary/20 bg-primary/[0.02] shadow-[0_0_40px_rgba(var(--primary-rgb),0.07)]" 
            : "border-border-muted/5 bg-bg-surface/20 hover:border-border-muted/20 hover:bg-bg-surface/30 shadow-sm"
        )}
      >
        {/* Header */}
        <button
          onClick={() => !isStreaming && setIsExpanded(!isExpanded)}
          disabled={isStreaming}
          className={cn(
            "w-full flex items-center justify-between px-4 py-3 text-left transition-colors",
            isStreaming ? "cursor-default" : "cursor-pointer hover:bg-bg-surface/40"
          )}
        >
          <div className="flex items-center gap-3">
            <div className="relative">
              {isStreaming ? (
                <motion.div
                  animate={{ 
                    scale: [1, 1.2, 1],
                    opacity: [0.5, 1, 0.5]
                  }}
                  transition={{ 
                    duration: 2,
                    repeat: Infinity,
                    ease: "easeInOut"
                  }}
                  className="p-1.5 rounded-lg bg-primary/10 text-primary"
                >
                  <BrainCircuit size={14} />
                </motion.div>
              ) : (
                <div className="p-1.5 rounded-lg bg-bg-base/50 text-text-muted/60">
                  <BrainCircuit size={14} />
                </div>
              )}
              {isStreaming && (
                <div className="absolute -inset-1 bg-primary/20 blur-sm rounded-full animate-pulse" />
              )}
            </div>
            
            <div className="flex flex-col">
              <span className={cn(
                "text-[10px] font-black uppercase tracking-[0.2em]",
                isStreaming ? "text-primary" : "text-text-muted/40"
              )}>
                {isStreaming ? "Synthesizing..." : label}
              </span>
              {isStreaming && (
                <span className="text-[9px] text-primary/40 font-bold animate-pulse">
                  Quantum Inference in progress
                </span>
              )}
            </div>
          </div>

          {!isStreaming && (
            <motion.div
              animate={{ rotate: isExpanded ? 180 : 0 }}
              className="text-text-muted/20"
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
              transition={{ duration: 0.3, ease: "easeOut" }}
            >
              <div className="px-5 pb-5 pt-1">
                <div className="relative">
                  {/* Vertical line indicator */}
                  <div className="absolute left-0 top-0 bottom-0 w-px bg-gradient-to-b from-primary/20 via-primary/5 to-transparent" />
                  
                  <div className="pl-5 text-[12px] leading-relaxed text-text-muted/70 font-sans italic space-y-2">
                    {content.split("\n\n").map((para, i) => (
                      <p key={i} className="animate-in fade-in slide-in-from-left-1 duration-500" style={{ animationDelay: `${i * 100}ms` }}>
                        {para}
                      </p>
                    ))}
                    {isStreaming && (
                      <span className="inline-block w-1.5 h-3 ml-1 bg-primary/40 animate-pulse rounded-full" />
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      
      {!isExpanded && !isStreaming && content && (
        <div className="px-4 mt-1 opacity-0 group-hover/think:opacity-100 transition-opacity duration-300">
           <p className="text-[9px] text-text-muted/30 truncate max-w-[400px]">
             {content.slice(0, 100)}...
           </p>
        </div>
      )}
    </div>
  );
});
