import { Cpu, Zap, Activity, Info } from "lucide-react";
import { useTranslation } from "../i18n";
import { useAppStore } from "../stores/appStore";
import { cn } from "../lib/utils";
import { useMemo } from "react";

export function ResourceStats() {
  const { t } = useTranslation();
  const activeTaskId = useAppStore((s) => s.activeTaskId);
  const tasks = useAppStore((s) => s.tasks);
  const activeTask = useMemo(() => tasks.find((t) => t.id === activeTaskId), [tasks, activeTaskId]);
  
  if (!activeTask) return null;

  const stats = activeTask.stats;
  const isRunning = activeTask.status === "running";

  return (
    <div className="flex flex-col h-full bg-bg-surface/30 rounded-xl border border-border-muted/20 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-muted/30 bg-bg-elevated/20">
        <div className="flex items-center gap-2">
          <Activity size={14} className={cn("text-emerald-500", isRunning && "animate-pulse")} />
          <span className="text-[11px] font-black uppercase tracking-wider text-text-muted">
            {t("engine_monitor_title")}
          </span>
        </div>
        <div className={cn(
          "h-1.5 w-1.5 rounded-full shadow-glow",
          isRunning ? "bg-emerald-500" : "bg-text-muted/30"
        )} />
      </div>

      <div className="flex-1 p-3 space-y-4 overflow-y-auto custom-scrollbar">
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-bg-subtle/30 rounded-lg p-2 border border-border-subtle/50">
            <div className="flex items-center gap-1.5 text-text-muted mb-1">
              <Cpu size={11} />
              <span className="text-[9px] font-bold uppercase tracking-tighter">CPU 使用率</span>
            </div>
            <div className="text-sm font-mono font-black text-text-main">
              {(stats?.cpu_percent ?? 0).toFixed(1)}%
            </div>
          </div>

          <div className="bg-bg-subtle/30 rounded-lg p-2 border border-border-subtle/50">
            <div className="flex items-center gap-1.5 text-text-muted mb-1">
              <Zap size={11} />
              <span className="text-[9px] font-bold uppercase tracking-tighter">内存占用</span>
            </div>
            <div className="text-sm font-mono font-black text-text-main">
              {stats?.memory_mb ?? 0} MB
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-text-muted px-1">
            <Info size={11} />
            <span className="text-[9px] font-bold uppercase tracking-widest">Token 累计消耗</span>
          </div>
          
          <div className="bg-bg-subtle/40 rounded-xl p-3 border border-border-subtle flex items-center justify-between relative overflow-hidden group">
             <div className="absolute inset-0 bg-primary-500/2 opacity-0 group-hover:opacity-100 transition-opacity" />
             
             <div className="relative z-10 flex flex-col">
               <span className="text-[8px] text-text-muted uppercase font-black tracking-widest mb-0.5">Input</span>
               <span className="text-sm font-mono font-black text-primary-500">
                 {(stats?.approx_input_tokens ?? 0).toLocaleString()}
               </span>
             </div>
             
             <div className="h-8 w-px bg-border-subtle mx-2" />
             
             <div className="relative z-10 flex flex-col text-right">
               <span className="text-[8px] text-text-muted uppercase font-black tracking-widest mb-0.5">Output</span>
               <span className="text-sm font-mono font-black text-emerald-500">
                 {(stats?.approx_output_tokens ?? 0).toLocaleString()}
               </span>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
}
