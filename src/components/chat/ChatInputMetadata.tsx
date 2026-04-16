import { memo } from "react";
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
  const { currentMode } = useHarness(taskId || undefined);

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
        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-accent/5 border border-accent/20 shadow-sm transition-all hover:bg-accent/10 hover:border-accent/40 group/harness cursor-pointer">
           {currentMode === 'strategic' && (
             <>
               <Target size={12} className="text-blue-400 group-hover/harness:rotate-12 transition-transform" />
               <span className="text-[10px] font-bold tracking-tight text-blue-400/90">Strategic</span>
             </>
           )}
           {currentMode === 'action' && (
             <>
               <Zap size={12} className="text-amber-400 group-hover/harness:scale-125 transition-transform" />
               <span className="text-[10px] font-bold tracking-tight text-amber-400/90">Action</span>
             </>
           )}
           {currentMode === 'review' && (
             <>
               <ShieldCheck size={12} className="text-emerald-400 group-hover/harness:translate-y-[-1px] transition-transform" />
               <span className="text-[10px] font-bold tracking-tight text-emerald-400/90">Review</span>
             </>
           )}
        </div>
      )}
    </div>
  );
});
