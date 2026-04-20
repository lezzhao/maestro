import { Plus, MessageSquare, Trash2, Clock, Sparkles, Search, X } from "lucide-react";
import { useTaskStoreState } from "../hooks/use-app-store-selectors";
import { useTaskActions } from "../hooks/useTaskActions";
import { useTranslation } from "../i18n";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { useState, useMemo } from "react";

export function TaskSidebar() {
  const { t } = useTranslation();
  const { tasks: allTasks, activeWorkspaceId, activeTaskId, removeTask, setActiveTaskId } =
    useTaskStoreState();
  const { handleAddTask } = useTaskActions();
  const [searchQuery, setSearchQuery] = useState("");

  const tasks = useMemo(() => {
    let filtered = activeWorkspaceId 
      ? allTasks.filter(t => (t.workspaceId || null) === activeWorkspaceId)
      : allTasks;
    
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(t => 
        t.name?.toLowerCase().includes(q) || 
        t.id.toLowerCase().includes(q)
      );
    }
    return filtered;
  }, [allTasks, activeWorkspaceId, searchQuery]);

  const handleNewTask = (e: React.MouseEvent) => {
    e.stopPropagation();
    void handleAddTask("");
  };

  const formatDate = (ts: number) => {
    const date = new Date(ts);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/5 mb-2">
        <h3 className="text-[10px] font-black text-muted-foreground/30 uppercase tracking-[0.2em] pl-1">
          {t("active_tasks") || "Flows"}
        </h3>
        <button
          className="p-1 px-1.5 rounded-lg hover:bg-primary/10 text-muted-foreground/40 hover:text-primary transition-all active:scale-95"
          onClick={handleNewTask}
        >
          <Plus size={12} />
        </button>
      </div>

      {allTasks.length > 3 && (
        <div className="px-3 mb-3">
          <div className="relative group">
            <div className="absolute inset-y-0 left-2.5 flex items-center pointer-events-none text-muted-foreground/20 group-focus-within:text-primary/40 transition-colors">
              <Search size={12} />
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter flows..."
              className="w-full h-8 pl-8 pr-8 bg-muted/10 border border-border/5 rounded-lg text-[11px] focus:outline-none focus:ring-1 focus:ring-primary/20 focus:bg-background transition-all placeholder:text-muted-foreground/20"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute inset-y-0 right-2 flex items-center text-muted-foreground/20 hover:text-foreground"
              >
                <X size={10} />
              </button>
            )}
          </div>
        </div>
      )}

      <div className="space-y-0.5 px-3">
        {tasks.length === 0 ? (
          <div className="px-4 py-6 text-center border-t border-border/5">
            <p className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground/20">
              {t("no_tasks_desc") || "Idle"}
            </p>
          </div>
        ) : (
          tasks.map((task) => (
            <div
              key={task.id}
              className={cn(
                "group relative flex flex-col gap-1 px-4 py-3 rounded-xl transition-all duration-200 cursor-pointer border",
                activeTaskId === task.id
                  ? "bg-secondary/80 border-border shadow-sm ring-1 ring-primary/5"
                  : "bg-transparent border-transparent hover:bg-secondary/40"
              )}
              onClick={() => setActiveTaskId(task.id)}
            >
              <div className="flex items-center justify-between gap-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className={cn(
                    "w-2 h-2 rounded-full transition-all duration-500",
                    task.status === "running" ? "bg-primary animate-pulse shadow-[0_0_8px_hsla(var(--primary),0.4)]" : 
                    task.status === "error" ? "bg-destructive" :
                    task.status === "verified" ? "bg-emerald-500" :
                    task.status === "needs_review" ? "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.2)]" :
                    task.status === "completed" ? "bg-primary/40" : "bg-muted-foreground/20"
                  )} />
                  <span className={cn(
                    "text-[13px] font-semibold truncate transition-colors tracking-tight",
                    activeTaskId === task.id ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"
                  )}>
                    {task.name || "Untitled Flow"}
                  </span>
                </div>
                <button
                  className="opacity-0 group-hover:opacity-100 p-1 rounded-md text-muted-foreground/30 hover:text-destructive hover:bg-destructive/10 transition-all active:scale-90"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm("Delete flow?")) {
                      removeTask(task.id);
                    }
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </div>

              <div className="flex items-center gap-3 text-[10px] font-medium text-muted-foreground/40 pl-4.5">
                <span>{formatDate(task.created_at)}</span>
                <span className="w-0.5 h-0.5 rounded-full bg-border" />
                <span className="tabular-nums">
                  {((task.stats?.approx_input_tokens || 0) + (task.stats?.approx_output_tokens || 0)).toLocaleString()} Tokens
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
