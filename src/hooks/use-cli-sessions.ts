import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  listCliSessionsCommand,
  pruneCliSessionsCommand,
  readCliSessionLogsCommand,
} from "./diagnostics-commands";
import type { CliSessionListItem } from "../types";

interface UseCliSessionsOptions {
  logLimit?: number;
}

interface LoadCliSessionsOptions {
  shouldClearMessage?: boolean;
}

export function useCliSessions(activeEngineId: string, options?: UseCliSessionsOptions) {
  const logLimit = options?.logLimit ?? 120;
  const [sessions, setSessions] = useState<CliSessionListItem[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [sessionLogs, setSessionLogs] = useState("");
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [pruning, setPruning] = useState(false);
  const [message, setMessage] = useState("");
  const selectedSessionIdRef = useRef("");

  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId;
  }, [selectedSessionId]);

  const loadSessions = useCallback(async (options?: LoadCliSessionsOptions) => {
    const shouldClearMessage = options?.shouldClearMessage ?? true;
    setLoadingSessions(true);
    try {
      const items = await listCliSessionsCommand(activeEngineId);
      setSessions(items);
      if (items.length === 0) {
        setSelectedSessionId("");
        setSessionLogs("");
        return;
      }
      const currentSelectedId = selectedSessionIdRef.current;
      if (!currentSelectedId || !items.some((item) => item.session_id === currentSelectedId)) {
        setSelectedSessionId(items[0].session_id);
      }
      if (shouldClearMessage) {
        setMessage("");
      }
    } catch (error) {
      setMessage(`加载 CLI 会话失败: ${String(error)}`);
    } finally {
      setLoadingSessions(false);
    }
  }, [activeEngineId]);

  const loadLogs = useCallback(async (sessionId?: string) => {
    const target = sessionId || selectedSessionIdRef.current;
    if (!target) return;
    setLoadingLogs(true);
    try {
      const logs = await readCliSessionLogsCommand(activeEngineId, target, logLimit);
      setSessionLogs(logs);
      setMessage("");
    } catch (error) {
      setSessionLogs("");
      setMessage(`读取日志失败: ${String(error)}`);
    } finally {
      setLoadingLogs(false);
    }
  }, [activeEngineId, logLimit]);

  const pruneStoppedSessions = useCallback(async () => {
    setPruning(true);
    try {
      const result = await pruneCliSessionsCommand(activeEngineId);
      setMessage(`已清理会话 ${result.deleted_sessions} 条，日志 ${result.deleted_logs} 个`);
      await loadSessions({ shouldClearMessage: false });
      setSessionLogs("");
    } catch (error) {
      setMessage(`清理会话失败: ${String(error)}`);
    } finally {
      setPruning(false);
    }
  }, [activeEngineId, loadSessions]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (!selectedSessionId) return;
    void loadLogs(selectedSessionId);
  }, [loadLogs, selectedSessionId]);

  const selectedSession = useMemo(
    () => sessions.find((item) => item.session_id === selectedSessionId) ?? null,
    [sessions, selectedSessionId],
  );

  return {
    sessions,
    selectedSessionId,
    setSelectedSessionId,
    sessionLogs,
    loadingSessions,
    loadingLogs,
    pruning,
    message,
    setMessage,
    setSessionLogs,
    selectedSession,
    loadSessions,
    loadLogs,
    pruneStoppedSessions,
  };
}
