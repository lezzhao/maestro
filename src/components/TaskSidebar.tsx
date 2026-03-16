import { Plus, MessageSquare, Trash2, Clock, PlayCircle } from "lucide-react";
import { useAppStore } from "../stores/appStore";
import { useShallow } from "zustand/react/shallow";
import { useTranslation } from "../i18n";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";

export function TaskSidebar() {
  const { t } = useTranslation();
  const { tasks, activeTaskId, addTask, removeTask, setActiveTaskId } = useAppStore(
    useShallow((s) => ({
      tasks: s.tasks,
      activeTaskId: s.activeTaskId,
      addTask: s.addTask,
      removeTask: s.removeTask,
      setActiveTaskId: s.setActiveTaskId,
    }))
  );

  const handleNewTask = () => {
    addTask("");
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
          className="h-6 w-6 rounded-lg hover:bg-primary-500/10 hover:text-primary-500"
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
                  "group relative flex flex-col gap-1 p-3 rounded-lg transition-all cursor-pointer border border-transparent mx-1",
                  activeTaskId === task.id
                    ? "bg-bg-elevated border-border-muted shadow-sm"
                    : "hover:bg-bg-elevated/40"
                )}
                onClick={() => setActiveTaskId(task.id)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={cn(
                      "w-1.5 h-1.5 rounded-full mt-0.5 shrink-0",
                      task.status === "running" ? "bg-emerald-500 animate-pulse" : 
                      task.status === "error" ? "bg-rose-500" :
                      task.status === "verified" ? "bg-sky-500" :
                      task.status === "needs_review" ? "bg-amber-500" :
                      task.status === "completed" ? "bg-primary-500" : "bg-text-muted/30"
                    )} />
                    <span className={cn(
                      "text-[12px] font-semibold truncate",
                      activeTaskId === task.id ? "text-primary-500" : "text-text-main"
                    )}>
                      {task.name}
                    </span>
                  </div>
                  {activeTaskId === task.id && (
                    <button
                      className="opacity-0 group-hover:opacity-60 hover:opacity-100! p-1 text-text-muted hover:text-rose-500 transition-all"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeTask(task.id);
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-3 text-[9px] font-semibold text-text-muted/40 uppercase">
                  <div className="flex items-center gap-1">
                    <Clock size={10} />
                    {formatDate(task.created_at)}
                  </div>
                  <div className="flex items-center gap-1">
                    <PlayCircle size={10} />
                    {(task.stats?.approx_input_tokens || 0) + (task.stats?.approx_output_tokens || 0)} T
                  </div>
                  <div>{task.status === "verified" ? "已验证" : task.status === "needs_review" ? "待审阅" : task.status}</div>
                </div>

                {activeTaskId === task.id && (
                  <div className="absolute right-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-primary-500 rounded-l-full" />
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
