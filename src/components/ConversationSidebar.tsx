import { useEffect, useMemo, useState } from "react";
import { useChatStore } from "../stores/chatStore";
import { useActiveTask } from "../hooks/useActiveTask";
import { useTaskRuntimeContext } from "../hooks/useTaskRuntimeContext";
import { MessageSquare, Plus, Trash2, Clock, Hash, Edit2, Check, X, Sparkles, Cpu, Zap } from "lucide-react";
import { useTranslation } from "../i18n";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";
import { formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale";
import { motion, AnimatePresence } from "framer-motion";

export function ConversationSidebar() {
  const { t } = useTranslation();
  const { activeTaskId } = useActiveTask();
  const { 
    conversationsByTask, 
    activeConversationId, 
    refreshConversations, 
    switchConversation, 
    createNewConversation, 
    deleteConversation,
    updateConversationTitle
  } = useChatStore();

  const { engineId: activeEngineId, profile: activeProfile } = useTaskRuntimeContext();
  const taskId = activeTaskId || "global";
  const conversations = useMemo(() => conversationsByTask[taskId] || [], [conversationsByTask, taskId]);
  const activeId = activeConversationId[taskId];

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");

  useEffect(() => {
    refreshConversations(activeTaskId);
  }, [activeTaskId, refreshConversations]);

  const handleCreate = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await createNewConversation(activeTaskId, activeEngineId, activeProfile?.id ?? "default");
  };

  const startEditing = (e: React.MouseEvent, conv: any) => {
    e.stopPropagation();
    setEditingId(conv.id);
    setEditTitle(conv.title || "Untitled");
  };

  const confirmRename = async (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    if (editingId && editTitle.trim()) {
      await updateConversationTitle(editingId, editTitle.trim());
    }
    setEditingId(null);
  };

  const cancelRename = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(null);
  };

  const getEngineIcon = (engineId: string) => {
    if (engineId?.includes("claude")) return <Zap size={10} className="text-amber-400" />;
    if (engineId?.includes("gemini")) return <Sparkles size={10} className="text-blue-400" />;
    if (engineId?.includes("codex") || engineId?.includes("openai")) return <Cpu size={10} className="text-emerald-400" />;
    return <Hash size={10} className="text-muted-foreground/40" />;
  };

  if (conversations.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col mt-6">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/5 mb-2">
        <h3 className="text-[10px] font-black text-muted-foreground/30 uppercase tracking-[0.2em] pl-1">
          {t("history") || "Threads"}
        </h3>
        <button 
          className="p-1 px-1.5 rounded-lg hover:bg-primary/10 text-muted-foreground/40 hover:text-primary transition-all active:scale-95"
          onClick={handleCreate}
        >
          <Plus size={12} />
        </button>
      </div>

      <div className="space-y-1 px-2">
        <AnimatePresence mode="popLayout" initial={false}>
          {conversations.map((conv) => (
            <motion.div
              layout
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              key={conv.id}
              onClick={() => !editingId && switchConversation(activeTaskId, conv.id)}
              className={cn(
                "group relative flex flex-col p-4 rounded-2xl cursor-pointer transition-all duration-300 border inner-border",
                activeId === conv.id 
                  ? "bg-glass-surface-strong border-white/[0.08] shadow-md scale-[1.02] z-10" 
                  : "bg-transparent border-transparent hover:bg-white/[0.02] hover:border-white/[0.04]"
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2.5">
                    {editingId === conv.id ? (
                      <div className="flex items-center gap-2 flex-1">
                        <input
                          autoFocus
                          className="bg-background border border-primary/40 rounded-lg px-2 py-1 text-[13px] w-full focus:outline-none ring-2 ring-primary/5"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") confirmRename(e);
                            if (e.key === "Escape") cancelRename(e as any);
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                    ) : (
                      <span className={cn(
                        "text-[13px] font-bold truncate block tracking-tight leading-tight",
                        activeId === conv.id ? "text-foreground" : "text-muted-foreground/70 group-hover:text-foreground"
                      )} onDoubleClick={(e) => startEditing(e, conv)}>
                        {conv.title || "Untitled Chat"}
                      </span>
                    )}
                  </div>
                  
                  <div className="flex items-center gap-3 text-[9px] font-black uppercase tracking-widest text-muted-foreground/20">
                    <div className="flex items-center gap-1.5">
                      {getEngineIcon(conv.engineId)}
                      <span className="opacity-80">{conv.engineId?.split("-")[0] || "core"}</span>
                    </div>
                    <span className="w-1 h-1 rounded-full bg-border/40" />
                    <span>{conv.messageCount} msg</span>
                  </div>
                </div>
                
                <div className="flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-all duration-300">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm("Delete thread?")) {
                        deleteConversation(activeTaskId, conv.id);
                      }
                    }}
                    className="p-1 px-1.5 rounded-lg text-muted-foreground/30 hover:text-rose-400 hover:bg-rose-400/10 transition-all"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
