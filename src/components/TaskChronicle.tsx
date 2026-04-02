import { useMemo, useRef, useEffect } from "react";
import { History, Zap, AlertCircle, ChevronRight, Clock, Loader2, Check } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "../lib/utils";
import type { ChatMessage } from "../types";

interface Props {
  messages: ChatMessage[];
  isLoading?: boolean;
}

export function TaskChronicle({ messages, isLoading = false }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const events = useMemo(() => {
    return messages.filter(m => 
      m.role === "plan" || 
      m.meta?.eventType === "tool" || 
      m.meta?.eventType === "notice" ||
      (m.role === "user" && m.content.length < 100)
    ).map(m => ({
      id: m.id,
      timestamp: m.timestamp,
      role: m.role,
      type: m.meta?.eventType || "message",
      status: m.meta?.eventStatus || "done",
      title: m.meta?.toolName || (m.role === "user" ? "指令" : m.role === "plan" ? "执行计划" : "通知"),
      content: m.content.slice(0, 150),
    }));
  }, [messages]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events.length]);

  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <div className="flex flex-col h-full bg-bg-surface/30 rounded-xl border border-border-muted/20 overflow-hidden shadow-2xl shadow-black/20 ring-1 ring-white/5">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5 bg-linear-to-b from-bg-elevated/40 to-transparent backdrop-blur-sm">
        <History size={14} className="text-primary drop-shadow-[0_0_5px_rgba(var(--primary-rgb),0.5)]" />
        <span className="text-[11px] font-black uppercase tracking-widest text-text-main/80">
          Task Chronicle
        </span>
        <div className="ml-auto flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20">
           <Zap size={10} className="text-primary animate-pulse" />
           <span className="text-[9px] font-black text-primary italic uppercase tracking-wider">{events.length}</span>
        </div>
      </div>

      {/* Content */}
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-1 relative scroll-smooth"
      >
        {/* Animated Timeline Line */}
        <div className="absolute left-[24.5px] top-6 bottom-6 w-[2px] bg-white/5 overflow-hidden rounded-full">
           <motion.div 
             initial={{ height: 0 }}
             animate={{ height: "100%" }}
             transition={{ duration: 1.5, ease: "easeOut" }}
             className="w-full bg-linear-to-b from-primary via-primary/40 to-transparent shadow-[0_0_10px_rgba(var(--primary-rgb),0.3)]"
           />
        </div>

        {isLoading && events.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-text-muted/40 py-20 px-8 text-center space-y-6">
             <div className="relative">
               <Loader2 size={32} className="text-primary animate-spin" />
               <div className="absolute inset-0 blur-lg bg-primary/20 rounded-full" />
             </div>
             <p className="text-[10px] font-black tracking-widest uppercase animate-pulse">Initializing Agent Context...</p>
          </div>
        ) : events.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-text-muted/20 py-20 px-8 text-center space-y-4">
             <Clock size={32} strokeWidth={1} className="opacity-50" />
             <p className="text-[10px] font-bold tracking-widest uppercase">No events recorded</p>
          </div>
        ) : (
          <AnimatePresence mode="popLayout" initial={false}>
            {events.map((event, index) => (
              <motion.div 
                layout
                initial={{ opacity: 0, x: -10, filter: "blur(4px)" }}
                animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, scale: 0.95 }}
                key={event.id} 
                className={cn(
                  "group relative pl-8 py-3 transition-all cursor-pointer rounded-lg border border-transparent hover:border-white/5 hover:bg-white/2",
                  index === events.length - 1 && event.status === "pending" && "bg-primary/3"
                )}
                onClick={() => {
                  window.dispatchEvent(
                    new CustomEvent("maestro:scroll-to-message", { detail: { id: event.id } })
                  );
                }}
              >
                {/* Status Indicator Node */}
                <div className={cn(
                  "absolute left-[-4px] top-[19px] w-3 h-3 rounded-full border-2 bg-bg-base z-10 transition-all flex items-center justify-center",
                  event.status === "pending" ? "border-primary shadow-[0_0_12px_rgba(var(--primary-rgb),0.6)]" : 
                  event.status === "error" ? "border-rose-500 shadow-[0_0_12px_rgba(244,63,94,0.4)]" : 
                  "border-primary/40 group-hover:border-primary/80 shadow-none"
                )}>
                  {event.status === "done" && (
                    <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}>
                      <Check size={8} className="text-primary stroke-[4px]" />
                    </motion.div>
                  )}
                  {event.status === "pending" && (
                    <div className="absolute inset-x-0 inset-y-0 rounded-full border-2 border-primary animate-ping opacity-40" />
                  )}
                </div>
                
                <div className="flex flex-col gap-1.5 px-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded border transition-colors",
                        event.type === "tool" ? "text-primary border-primary/20 bg-primary/10" :
                        event.role === "user" ? "text-sky-400 border-sky-400/20 bg-sky-400/10" :
                        "text-text-muted border-border-muted/20 bg-bg-elevated/40"
                      )}>
                        {event.title}
                      </span>
                      <span className="text-[8px] text-text-muted/40 font-mono tracking-tighter tabular-nums">
                        {formatTime(event.timestamp)}
                      </span>
                    </div>
                    {event.status === "pending" && (
                      <Loader2 size={10} className="text-primary animate-spin opacity-60" />
                    )}
                    {event.status === "error" && (
                      <motion.div animate={{ rotate: [0, 10, -10, 0] }} transition={{ repeat: Infinity, duration: 1.5 }}>
                        <AlertCircle size={10} className="text-rose-500" />
                      </motion.div>
                    )}
                  </div>

                  <p className={cn(
                    "text-[11px] line-clamp-2 leading-relaxed tracking-tight transition-all",
                    event.status === "pending" ? "text-text-main font-bold" : "text-text-muted/80 group-hover:text-text-main"
                  )}>
                    {event.content}
                  </p>
                  
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity text-[8px] text-primary font-black uppercase tracking-widest mt-1">
                     View Event Context <ChevronRight size={8} />
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>
      
      {/* Footer / Status Bar */}
      <div className="px-4 py-2 border-t border-white/5 bg-bg-base/40 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <div className={cn(
            "w-1.5 h-1.5 rounded-full",
            events.some(e => e.status === "pending") ? "bg-primary animate-pulse shadow-[0_0_8px_rgba(var(--primary-rgb),1)]" : "bg-emerald-500/40"
          )} />
          <span className="text-[9px] font-bold text-text-muted truncate uppercase tracking-tighter">
            {events.some(e => e.status === "pending") ? "Agent Working..." : "Agent Idle"}
          </span>
        </div>
        <div className="text-[8px] font-mono text-text-muted/30">
          ID: {events[events.length-1]?.id.slice(0,8) || "N/A"}
        </div>
      </div>
    </div>
  );
}
