import { Plus, MessageSquare, Trash2 } from "lucide-react";
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

  const tasks = allTasks.filter(t => (t.workspaceId || null) === (activeWorkspaceId || null));

  const handleNewTask = () => {
    void handleAddTask("");
  };

  const formatDate = (ts: number) => {
    const date = new Date(ts);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="flex flex-col h-full bg-transparent">
      <div className="flex items-center justify-between px-3 py-4">
        <h3 className="text-[11px] font-semibold text-text-muted/60 uppercase">
          {t("active_tasks") || "Active Tasks"}
        </h3>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 rounded-sm hover:bg-primary/10 hover:text-primary transition-colors"
          onClick={handleNewTask}
        >
          <Plus size={14} />
        </Button>
      </div>

      <div className="flex-1 -mx-2 px-2 overflow-y-auto custom-scrollbar">
        <div className="space-y-1 pb-4">
          {tasks.length === 0 ? (
            <div className="px-4 py-8 text-center space-y-3">
              <div className="w-10 h-10 rounded-full bg-bg-elevated/40 flex items-center justify-center mx-auto text-text-muted/30">
                <MessageSquare size={18} />
              </div>
              <p className="text-[10px] font-semibold text-text-muted/40 uppercase">
                {t("no_tasks_desc") || "No Active Tasks\nCreate one to start"}
              </p>
            </div>
          ) : (
            tasks.map((task) => (
              <div
                key={task.id}
                className={cn(
                  "group relative flex flex-col gap-1 px-2.5 py-1.5 rounded-sm transition-all cursor-pointer border mx-1 mb-0.5",
                  activeTaskId === task.id
                    ? "bg-primary/5 border-primary/20 shadow-glow"
                    : "bg-transparent border-transparent hover:bg-bg-elevated/40 hover:border-border-muted/10"
                )}
                onClick={() => setActiveTaskId(task.id)}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={cn(
                      "w-1.5 h-1.5 rounded-full shrink-0",
                      task.status === "running" ? "bg-primary animate-pulse" : 
                      task.status === "error" ? "bg-rose-500" :
                      task.status === "verified" ? "bg-sky-500" :
                      task.status === "needs_review" ? "bg-amber-500" :
                      task.status === "completed" ? "bg-primary" : "bg-text-muted/30"
                    )} />
                    <span className={cn(
                      "text-[11px] font-bold truncate transition-colors font-mono",
                      activeTaskId === task.id ? "text-primary" : "text-text-main/80 group-hover:text-text-main"
                    )}>
                      {task.name}
                    </span>
                  </div>
                  <button
                    className="opacity-0 group-hover:opacity-100 p-0.5 text-text-muted hover:text-rose-500 transition-all"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeTask(task.id);
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>

                <div className="flex items-center gap-3 text-[9px] font-bold text-text-muted/50 tracking-wide pl-3.5 mt-0.5">
                  <div className="flex items-center gap-1">
                    {formatDate(task.created_at)}
                  </div>
                  <div className="flex items-center gap-1">
                    {(task.stats?.approx_input_tokens || 0) + (task.stats?.approx_output_tokens || 0)} T
                  </div>
                </div>

                {activeTaskId === task.id && (
                  <div className="absolute left-[-4px] top-1/2 -translate-y-1/2 w-[3px] h-4 bg-primary rounded-r-sm" />
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
