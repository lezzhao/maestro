import { useEffect, useMemo, useState } from "react";
import { useChatStore } from "../stores/chatStore";
import { useActiveTask } from "../hooks/useActiveTask";
import { useTaskRuntimeContext } from "../hooks/useTaskRuntimeContext";
import { MessageSquare, Plus, Trash2, Clock, Hash, Edit2, Check, X, Sparkles, Cpu, Zap } from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";
import { formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale";
import { motion, AnimatePresence } from "framer-motion";

export function ConversationSidebar() {
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

  const handleCreate = async () => {
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
    if (engineId?.includes("claude")) return <Zap size={8} className="text-amber-500" />;
    if (engineId?.includes("gemini")) return <Sparkles size={8} className="text-blue-500" />;
    if (engineId?.includes("codex") || engineId?.includes("openai")) return <Cpu size={8} className="text-emerald-500" />;
    return <Hash size={8} className="text-text-muted/40" />;
  };

  return (
    <div className="flex flex-col h-full bg-transparent overflow-hidden border-t border-border-muted/5">
      <div className="p-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-text-muted">
          <Clock size={14} />
          <span className="text-[11px] font-bold uppercase tracking-wider">History</span>
        </div>
        <Button 
          variant="ghost" 
          size="icon" 
          className="h-6 w-6 rounded-md hover:bg-primary/10 hover:text-primary transition-all"
          onClick={handleCreate}
        >
          <Plus size={14} />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-4 custom-scrollbar">
        <AnimatePresence mode="popLayout" initial={false}>
          {conversations.length === 0 ? (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="py-12 px-4 text-center"
            >
              <div className="w-8 h-8 rounded-full bg-bg-surface/30 border border-border-muted/5 flex items-center justify-center mx-auto mb-3 opacity-20">
                <MessageSquare size={14} />
              </div>
              <p className="text-[11px] text-text-muted/40 italic font-medium uppercase tracking-tighter">No History Yet</p>
            </motion.div>
          ) : (
            conversations.map((conv) => (
              <motion.div
                layout
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                key={conv.id}
                onClick={() => !editingId && switchConversation(activeTaskId, conv.id)}
                className={cn(
                  "group relative flex flex-col p-3 rounded-xl cursor-pointer transition-all duration-300 border border-transparent my-1",
                  activeId === conv.id 
                    ? "bg-primary/5 border-primary/20 shadow-sm ring-1 ring-primary/5" 
                    : "hover:bg-bg-surface/80 hover:border-border-muted/20"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className="shrink-0 relative">
                        {activeId === conv.id && (
                          <div className="absolute -inset-1 bg-primary/20 blur-md rounded-full animate-pulse" />
                        )}
                        <MessageSquare size={12} className={cn(
                          "relative transition-colors",
                          activeId === conv.id ? "text-primary" : "text-text-muted/60 group-hover:text-text-muted"
                        )} />
                      </div>
                      
                      {editingId === conv.id ? (
                        <div className="flex items-center gap-1 flex-1">
                          <input
                            autoFocus
                            className="bg-bg-base border border-primary/30 rounded px-1.5 py-0.5 text-[12px] w-full focus:outline-none focus:ring-1 focus:ring-primary/50"
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") confirmRename(e);
                              if (e.key === "Escape") cancelRename(e as any);
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <button onClick={confirmRename} className="p-1 hover:text-emerald-500"><Check size={10} /></button>
                          <button onClick={cancelRename} className="p-1 hover:text-rose-500"><X size={10} /></button>
                        </div>
                      ) : (
                        <span className={cn(
                          "text-[12px] font-bold truncate block tracking-tight line-clamp-1",
                          activeId === conv.id ? "text-text-main" : "text-text-muted group-hover:text-text-main"
                        )} onDoubleClick={(e) => startEditing(e, conv)}>
                          {conv.title || "Untitled Conversation"}
                        </span>
                      )}
                    </div>
                    
                    <div className="flex items-center gap-2 text-[9px] font-medium uppercase tracking-[0.05em] text-text-muted/50">
                      <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-bg-surface/50 border border-border-muted/10">
                        {getEngineIcon(conv.engineId)}
                        <span className="opacity-80">{conv.engineId?.split("-")[0] || "core"}</span>
                      </div>
                      <span>•</span>
                      <span>{conv.messageCount} messages</span>
                      <span>•</span>
                      <span className="opacity-40 whitespace-nowrap">
                        {formatDistanceToNow(conv.updatedAt, { addSuffix: true, locale: zhCN })}
                      </span>
                    </div>
                  </div>
                  
                  <div className="flex flex-col gap-1.5 opacity-0 group-hover:opacity-100 transition-all">
                    <button
                      onClick={(e) => startEditing(e, conv)}
                      className="p-1.5 rounded-lg hover:bg-primary/10 hover:text-primary transition-colors"
                      title="Rename"
                    >
                      <Edit2 size={10} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm("Delete this conversation?")) {
                          deleteConversation(activeTaskId, conv.id);
                        }
                      }}
                      className="p-1.5 rounded-lg hover:bg-destructive/10 hover:text-destructive transition-colors"
                      title="Delete"
                    >
                      <Trash2 size={10} />
                    </button>
                  </div>
                </div>
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
