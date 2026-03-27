import { useEffect, useMemo, useState } from "react";
import { FileText, RefreshCcw, Trash2 } from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { useCliSessions } from "../hooks/use-cli-sessions";
import { useChatStore } from "../stores/chatStore";
import { useShallow } from "zustand/react/shallow";

interface CliSessionPanelProps {
  activeEngineId: string;
  activeTaskId?: string | null;
}

export function CliSessionPanel({ activeEngineId, activeTaskId = null }: CliSessionPanelProps) {
  const [scope, setScope] = useState<"task" | "engine">("task");
  const {
    sessions,
    selectedSessionId,
    setSelectedSessionId,
    sessionLogs,
    setSessionLogs,
    loadingSessions,
    loadingLogs,
    pruning,
    message,
    loadSessions,
    loadLogs,
    pruneStoppedSessions,
  } = useCliSessions(activeEngineId, { logLimit: 80 });
  const taskRunIds = useChatStore(useShallow((s) => s.getTaskRuns(activeTaskId).map(run => run.id)));
  const taskRunIdSet = useMemo(() => new Set(taskRunIds), [taskRunIds]);
  const visibleSessions = useMemo(() => {
    if (scope !== "task" || !activeTaskId) return sessions;
    return sessions.filter(
      (item) => item.task_id === activeTaskId || taskRunIdSet.has(item.session_id),
    );
  }, [activeTaskId, scope, sessions, taskRunIdSet]);

  const selectedSession = useMemo(
    () => visibleSessions.find((item) => item.session_id === selectedSessionId) ?? null,
    [visibleSessions, selectedSessionId],
  );
  useEffect(() => {
    if (visibleSessions.length === 0) {
      setSelectedSessionId("");
      setSessionLogs("");
      return;
    }
    if (!visibleSessions.some((x) => x.session_id === selectedSessionId)) {
      setSelectedSessionId(visibleSessions[0].session_id);
    }
  }, [selectedSessionId, setSelectedSessionId, setSessionLogs, visibleSessions]);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-bg-surface">
      {/* Header Area */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-muted/30">
        <div className="flex items-center gap-2">
          <FileText size={15} className="text-primary-500" />
          <span className="text-[12px] font-bold text-text-main">
            Run Records
          </span>
          <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-bold opacity-80">
            {visibleSessions.length}
          </Badge>
        </div>
        <div className="flex items-center gap-1 text-text-muted">
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 hover:text-text-main"
            title="Refresh"
            disabled={loadingSessions}
            onClick={() => void loadSessions()}
          >
            <RefreshCcw size={14} className={loadingSessions ? "animate-spin" : ""} />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 hover:text-rose-500 hover:bg-rose-500/10"
            title="Prune stopped sessions"
            disabled={pruning}
            onClick={() => void pruneStoppedSessions()}
          >
            <Trash2 size={14} className={pruning ? "animate-pulse" : ""} />
          </Button>
        </div>
      </div>

      {/* Controls Area */}
      <div className="px-4 py-3 space-y-3 border-b border-border-muted/20 bg-bg-base/30">
        <div className="flex bg-bg-elevated/40 p-1 rounded-lg">
          <button
            className={`flex-1 text-[11px] font-semibold py-1.5 rounded-md transition-colors ${
              scope === "task" 
                ? "bg-bg-surface text-text-main shadow-sm" 
                : "text-text-muted hover:text-text-main"
            }`}
             disabled={!activeTaskId}
             onClick={() => setScope("task")}
          >
            当前任务
          </button>
           <button
            className={`flex-1 text-[11px] font-semibold py-1.5 rounded-md transition-colors ${
              scope === "engine" 
                ? "bg-bg-surface text-text-main shadow-sm" 
                : "text-text-muted hover:text-text-main"
            }`}
             onClick={() => setScope("engine")}
          >
            当前引擎
          </button>
        </div>
        
        <div className="flex gap-2">
          <select
            className="flex-1 h-8 rounded-md border-0 bg-bg-elevated/50 px-3 text-[12px] text-text-main outline-none focus:ring-1 focus:ring-primary-500/50 appearance-none cursor-pointer"
            value={selectedSessionId}
            onChange={(event) => setSelectedSessionId(event.target.value)}
          >
            {visibleSessions.length === 0 ? (
              <option value="" disabled>
                {scope === "task" ? "暂无任务记录" : "暂无会话"}
              </option>
            ) : (
              visibleSessions.map((item) => (
                <option key={item.session_id} value={item.session_id}>
                  {item.session_id.substring(0,8)}... ({item.mode}/{item.status})
                </option>
              ))
            )}
          </select>
          <Button
            size="sm"
            variant="secondary"
            className="h-8 px-3 text-[11px] font-semibold bg-bg-elevated hover:bg-bg-surface hover:text-primary-500 transition-colors"
            disabled={!selectedSessionId || loadingLogs}
            onClick={() => void loadLogs()}
          >
            刷新日志
          </Button>
        </div>
      </div>

      {message && <div className="px-4 py-2 text-[11px] text-amber-500 bg-amber-500/10 border-b border-amber-500/20">{message}</div>}

      <div className="flex-1 min-h-0 bg-bg-base relative">
        <pre className="h-full w-full overflow-auto custom-scrollbar p-4 text-[11px] leading-relaxed text-text-muted whitespace-pre-wrap wrap-break-word font-mono">
          {sessionLogs || "Waiting for logs..."}
        </pre>
      </div>

      {/* Footer Meta */}
      {selectedSession && (
        <div className="px-4 py-2 border-t border-border-muted/20 bg-bg-surface/50 text-[10px] text-text-muted flex items-center justify-between font-mono">
           <span>Engine: {selectedSession.engine_id || "None"}</span>
           <span className="opacity-70">{selectedSession.source || "CLI"} · {selectedSession.status}</span>
        </div>
      )}
    </div>
  );
}
