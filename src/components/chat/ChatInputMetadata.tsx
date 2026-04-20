import { memo, useState, useEffect } from "react";
import { Target, Zap, ShieldCheck, AlertCircle } from "lucide-react";
import { cn } from "../../lib/utils";
import { useHarness } from "../../hooks/useHarness";

interface ChatInputMetadataProps {
  taskId: string | null;
  sendBlocked: boolean;
  sendBlockedReason: string;
}

export const ChatInputMetadata = memo(function ChatInputMetadata({
  taskId,
  sendBlocked,
  sendBlockedReason,
}: ChatInputMetadataProps) {
  const { currentMode, transitionTo, isLoading } = useHarness(taskId || undefined);
  const [optimisticMode, setOptimisticMode] = useState<string | null>(null);

  // Reset optimistic state once the real state syncs
  useEffect(() => {
    setOptimisticMode(null);
  }, [currentMode]);

  const activeMode = optimisticMode || currentMode;

  const handleModeClick = (mode: "strategic" | "action" | "review") => {
    if (mode === activeMode) return;
    setOptimisticMode(mode);
    transitionTo(mode);
  };

  return (
    <div className="flex items-center gap-4">
      {/* Context Status */}
      <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-background/40 border border-border/20 shadow-sm transition-colors hover:border-border/60 group/status cursor-default">
        <div className={cn(
          "w-1.5 h-1.5 rounded-full shadow-[0_0_8px_rgba(0,0,0,0.2)]",
          sendBlocked 
            ? "bg-red-400" 
            : "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.4)] animate-pulse"
        )}></div>
        <span className="text-[9px] font-black tracking-[0.15em] text-muted-foreground/60 transition-colors uppercase">
          {sendBlocked ? "Offline" : "Shield Active"}
        </span>
      </div>

      {/* Harness Mode Badge */}
      {taskId && (
        <div className="flex items-center gap-2">
           <button 
             onClick={() => handleModeClick("strategic")}
             className={cn(
               "flex items-center gap-2 px-3 py-1 rounded-full border shadow-sm transition-all group/harness relative overflow-hidden",
               activeMode === 'strategic' 
                 ? "bg-blue-400/10 border-blue-400/30" 
                 : "bg-background/40 border-border/20 opacity-40 hover:opacity-100"
             )}
           >
             <Target size={12} className={cn("transition-transform group-hover/harness:rotate-12", activeMode === 'strategic' ? "text-blue-400" : "text-muted-foreground")} />
             <span className={cn("text-[10px] font-bold tracking-tight", activeMode === 'strategic' ? "text-blue-400/90" : "text-muted-foreground")}>Strategic</span>
             {isLoading && optimisticMode === 'strategic' && <div className="absolute inset-0 bg-blue-400/5 animate-pulse" />}
           </button>

           <button 
             onClick={() => handleModeClick("action")}
             className={cn(
               "flex items-center gap-2 px-3 py-1 rounded-full border shadow-sm transition-all group/harness relative overflow-hidden",
               activeMode === 'action' 
                 ? "bg-amber-400/10 border-amber-400/30" 
                 : "bg-background/40 border-border/20 opacity-40 hover:opacity-100"
             )}
           >
             <Zap size={12} className={cn("transition-transform group-hover/harness:scale-125", activeMode === 'action' ? "text-amber-400" : "text-muted-foreground")} />
             <span className={cn("text-[10px] font-bold tracking-tight", activeMode === 'action' ? "text-amber-400/90" : "text-muted-foreground")}>Action</span>
             {isLoading && optimisticMode === 'action' && <div className="absolute inset-0 bg-amber-400/5 animate-pulse" />}
           </button>

           <button 
             onClick={() => handleModeClick("review")}
             className={cn(
               "flex items-center gap-2 px-3 py-1 rounded-full border shadow-sm transition-all group/harness relative overflow-hidden",
               activeMode === 'review' 
                 ? "bg-emerald-400/10 border-emerald-400/30" 
                 : "bg-background/40 border-border/20 opacity-40 hover:opacity-100"
             )}
           >
             <ShieldCheck size={12} className={cn("transition-transform group-hover/harness:translate-y-[-1px]", activeMode === 'review' ? "text-emerald-400" : "text-muted-foreground")} />
             <span className={cn("text-[10px] font-bold tracking-tight", activeMode === 'review' ? "text-emerald-400/90" : "text-muted-foreground")}>Review</span>
             {isLoading && optimisticMode === 'review' && <div className="absolute inset-0 bg-emerald-400/5 animate-pulse" />}
           </button>
        </div>
      )}
    </div>
  );
});
