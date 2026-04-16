import { Plus, MessageSquare, Trash2, Clock, Sparkles } from "lucide-react";
import { useTaskStoreState } from "../hooks/use-app-store-selectors";
import { useTaskActions } from "../hooks/useTaskActions";
import { useTranslation } from "../i18n";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";

export function TaskSidebar() {
  const { t } = useTranslation();
  const { tasks: allTasks, activeWorkspaceId, activeTaskId, removeTask, setActiveTaskId } =
    useTaskStoreState();
  const { handleAddTask } = useTaskActions();

  const tasks = activeWorkspaceId 
    ? allTasks.filter(t => (t.workspaceId || null) === activeWorkspaceId)
    : allTasks;

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
      <div className="flex items-center justify-between px-4 py-2 mb-2">
        <h3 className="text-[10px] font-black text-muted-foreground/40 uppercase tracking-[0.2em] pl-1">
          {t("active_tasks") || "Flows"}
        </h3>
        <button
          className="p-1 px-1.5 rounded-lg hover:bg-primary/10 text-muted-foreground/60 hover:text-primary transition-all active:scale-95"
          onClick={handleNewTask}
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="space-y-1 px-2">
        {tasks.length === 0 ? (
          <div className="px-4 py-8 text-center bg-muted/5 rounded-2xl border border-dashed border-border/20">
            <p className="text-[11px] font-medium text-muted-foreground/30">
              {t("no_tasks_desc") || "Ready for a new flow?"}
            </p>
          </div>
        ) : (
          tasks.map((task) => (
            <div
              key={task.id}
              className={cn(
                "group relative flex flex-col gap-1 px-4 py-3 rounded-2xl transition-all duration-300 cursor-pointer border inner-border",
                activeTaskId === task.id
                  ? "bg-glass-surface-strong border-white/[0.08] shadow-md scale-[1.02] z-10"
                  : "bg-transparent border-transparent hover:bg-white/[0.02] hover:border-white/[0.04]"
              )}
              onClick={() => setActiveTaskId(task.id)}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className={cn(
                    "status-dot transition-all duration-500",
                    task.status === "running" ? "bg-emerald-400 status-dot-pulse" : 
                    task.status === "error" ? "bg-rose-400" :
                    task.status === "verified" ? "bg-blue-400" :
                    task.status === "needs_review" ? "bg-amber-400 status-dot-pulse" :
                    task.status === "completed" ? "bg-primary" : "bg-muted-foreground/20"
                  )} />
                  <span className={cn(
                    "text-[13px] font-bold truncate transition-colors tracking-tight",
                    activeTaskId === task.id ? "text-foreground" : "text-muted-foreground/70 group-hover:text-foreground"
                  )}>
                    {task.name}
                  </span>
                </div>
                <button
                  className="opacity-0 group-hover:opacity-100 p-1 rounded-md text-muted-foreground/30 hover:text-rose-400 hover:bg-rose-400/10 transition-all"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm("Delete flow?")) {
                      removeTask(task.id);
                    }
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </div>

              <div className="flex items-center gap-3 text-[9px] font-black text-muted-foreground/20 tracking-widest pl-4">
                <div className="flex items-center gap-1.5 uppercase">
                  {formatDate(task.created_at)}
                </div>
                <div className="flex items-center gap-1.5 uppercase">
                  {(task.stats?.approx_input_tokens || 0) + (task.stats?.approx_output_tokens || 0)} tokens
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
