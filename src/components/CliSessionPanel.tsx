import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FileText, RefreshCcw, Trash2 } from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { useChatStore } from "../stores/chatStore";
import { useShallow } from "zustand/react/shallow";
import type { CliPruneResult, CliSessionListItem } from "../types";

interface CliSessionPanelProps {
  activeEngineId: string;
  activeTaskId?: string | null;
}

export function CliSessionPanel({ activeEngineId, activeTaskId = null }: CliSessionPanelProps) {
  const [sessions, setSessions] = useState<CliSessionListItem[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [sessionLogs, setSessionLogs] = useState("");
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [pruning, setPruning] = useState(false);
  const [message, setMessage] = useState("");
  const [scope, setScope] = useState<"task" | "engine">("task");
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

  const loadSessions = async () => {
    setLoadingSessions(true);
    try {
      const items = await invoke<CliSessionListItem[]>("cli_list_sessions", {
        engineId: activeEngineId || null,
      });
      setSessions(items);
      if (items.length === 0) {
        setSelectedSessionId("");
        setSessionLogs("");
        return;
      }
      setMessage("");
    } catch (error) {
      setMessage(`加载会话失败: ${String(error)}`);
    } finally {
      setLoadingSessions(false);
    }
  };

  const loadLogs = async (sessionId?: string) => {
    const target = sessionId || selectedSessionId;
    if (!target) return;
    setLoadingLogs(true);
    try {
      const logs = await invoke<string>("cli_read_session_logs", {
        engineId: activeEngineId,
        sessionId: target,
        limit: 80,
      });
      setSessionLogs(logs);
      setMessage("");
    } catch (error) {
      setSessionLogs("");
      setMessage(`读取日志失败: ${String(error)}`);
    } finally {
      setLoadingLogs(false);
    }
  };

  const pruneStoppedSessions = async () => {
    setPruning(true);
    try {
      const result = await invoke<CliPruneResult>("cli_prune_sessions", {
        engineId: activeEngineId || null,
        status: "stopped",
        olderThanHours: 0,
      });
      setMessage(`已清理会话 ${result.deleted_sessions} 条，日志 ${result.deleted_logs} 个`);
      await loadSessions();
      setSessionLogs("");
    } catch (error) {
      setMessage(`清理会话失败: ${String(error)}`);
    } finally {
      setPruning(false);
    }
  };

  useEffect(() => {
    void loadSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在活跃引擎变化时刷新
  }, [activeEngineId]);

  useEffect(() => {
    if (!selectedSessionId) return;
    void loadLogs(selectedSessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在选择会话变化时拉取
  }, [selectedSessionId]);

  useEffect(() => {
    if (visibleSessions.length === 0) {
      setSelectedSessionId("");
      setSessionLogs("");
      return;
    }
    if (!visibleSessions.some((x) => x.session_id === selectedSessionId)) {
      setSelectedSessionId(visibleSessions[0].session_id);
    }
  }, [selectedSessionId, visibleSessions]);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-bg-surface/30 rounded-xl border border-border-muted/20">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-muted/30 bg-bg-elevated/20">
        <div className="flex items-center gap-2">
          <FileText size={14} className="text-primary-500" />
          <span className="text-[11px] font-black uppercase tracking-wider text-text-muted">
            Run Records
          </span>
          <Badge variant="secondary" className="h-4 px-1.5 text-[9px] font-bold">
            {visibleSessions.length}
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 text-text-muted hover:text-text-main"
            disabled={loadingSessions}
            onClick={() => void loadSessions()}
          >
            <RefreshCcw size={12} className={loadingSessions ? "animate-spin" : ""} />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 text-text-muted hover:text-rose-500"
            disabled={pruning}
            onClick={() => void pruneStoppedSessions()}
          >
            <Trash2 size={12} className={pruning ? "animate-pulse" : ""} />
          </Button>
        </div>
      </div>

      <div className="p-2 space-y-2 border-b border-border-muted/20">
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant={scope === "task" ? "default" : "outline"}
            className="h-6 px-2 text-[10px] font-semibold flex-1"
            disabled={!activeTaskId}
            onClick={() => setScope("task")}
          >
            当前任务
          </Button>
          <Button
            size="sm"
            variant={scope === "engine" ? "default" : "outline"}
            className="h-6 px-2 text-[10px] font-semibold flex-1"
            onClick={() => setScope("engine")}
          >
            当前引擎
          </Button>
        </div>
        <select
          className="w-full h-8 rounded-md border border-border-subtle bg-bg-base px-2 text-[11px]"
          value={selectedSessionId}
          onChange={(event) => setSelectedSessionId(event.target.value)}
        >
          {visibleSessions.length === 0 ? (
            <option value="">
              {scope === "task" ? "当前任务暂无运行记录（可切到当前引擎）" : "暂无会话"}
            </option>
          ) : (
            visibleSessions.map((item) => (
              <option key={item.session_id} value={item.session_id}>
                {item.session_id} ({item.source || "unknown"}/{item.mode}/{item.status})
              </option>
            ))
          )}
        </select>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[10px] font-semibold w-full"
          disabled={!selectedSessionId || loadingLogs}
          onClick={() => void loadLogs()}
        >
          读取输出
        </Button>
      </div>

      {message && <div className="px-2 py-1 text-[10px] text-amber-500 break-all">{message}</div>}

      <div className="flex-1 min-h-0 p-2">
        <pre className="h-full overflow-auto custom-scrollbar rounded-md border border-border-subtle bg-bg-code p-2 text-[10px] whitespace-pre-wrap wrap-break-word">
          {sessionLogs || "暂无日志"}
        </pre>
      </div>

      {selectedSession && (
        <div className="px-2 py-1 border-t border-border-muted/20 text-[9px] text-text-muted flex items-center justify-between">
          <span>{selectedSession.engine_id} · {selectedSession.source || "unknown"}</span>
          <span>{selectedSession.mode} / {selectedSession.status}</span>
        </div>
      )}
    </div>
  );
}
