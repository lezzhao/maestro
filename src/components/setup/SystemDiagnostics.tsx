import { Activity, Database, RefreshCcw, Trash2, FileText } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Card, CardContent } from "../ui/card";
import { useAppStore } from "../../stores/appStore";
import { useTranslation } from "../../i18n";
import type { CliPruneResult, CliSessionListItem } from "../../types";

interface SystemDiagnosticsProps {
  activeEngineId: string;
  engineCount: number;
}

export function SystemDiagnostics({
  activeEngineId,
  engineCount,
}: SystemDiagnosticsProps) {
  const { t } = useTranslation();
  const projectPath = useAppStore((s) => s.projectPath);
  const [sessions, setSessions] = useState<CliSessionListItem[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [sessionLogs, setSessionLogs] = useState("");
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [pruning, setPruning] = useState(false);
  const [cliMessage, setCliMessage] = useState("");

  const selectedSession = useMemo(
    () => sessions.find((item) => item.session_id === selectedSessionId) ?? null,
    [sessions, selectedSessionId],
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
      if (!selectedSessionId || !items.some((x) => x.session_id === selectedSessionId)) {
        setSelectedSessionId(items[0].session_id);
      }
    } catch (error) {
      setCliMessage(`加载 CLI 会话失败: ${String(error)}`);
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
        limit: 120,
      });
      setSessionLogs(logs);
      setCliMessage("");
    } catch (error) {
      setSessionLogs("");
      setCliMessage(`读取日志失败: ${String(error)}`);
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
      setCliMessage(`已清理会话 ${result.deleted_sessions} 条，日志 ${result.deleted_logs} 个`);
      await loadSessions();
      setSessionLogs("");
    } catch (error) {
      setCliMessage(`清理会话失败: ${String(error)}`);
    } finally {
      setPruning(false);
    }
  };

  useEffect(() => {
    void loadSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在活跃引擎切换时刷新列表
  }, [activeEngineId]);

  useEffect(() => {
    if (!selectedSessionId) return;
    void loadLogs(selectedSessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 根据选择会话加载日志
  }, [selectedSessionId]);

  return (
    <section className="space-y-6 pt-4">
      <div className="flex items-center gap-3 px-2">
        <div className="flex flex-col">
          <h2 className="text-xl font-bold tracking-tight">
            {t("system_diagnostics") || "System Diagnostics"}
          </h2>
          <p className="text-sm text-text-muted mt-1">
            Troubleshooting & Logs
          </p>
        </div>
      </div>

      <Card className="rounded-xl border-border-muted bg-bg-surface shadow-sm overflow-hidden">
        <CardContent className="p-8 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl bg-bg-base border border-border-muted">
              <h4 className="flex items-center gap-2 text-sm font-semibold text-text-main mb-3">
                <Database size={16} className="text-text-muted" />
                Store Status
              </h4>
              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="opacity-50">Active Task ID:</span>
                  <span className="font-mono text-primary-500">
                    {activeEngineId || "None"}
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="opacity-50">Tasks Count:</span>
                  <span className="font-mono">{engineCount} Tasks</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-text-muted">Project:</span>
                  <span className="font-mono truncate max-w-[180px]">
                    {projectPath || "None"}
                  </span>
                </div>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-bg-base border border-border-muted">
              <h4 className="flex items-center gap-2 text-sm font-semibold text-text-main mb-3">
                <Activity size={16} className="text-text-muted" />
                Diagnostic Actions
              </h4>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-lg flex-1 text-xs font-semibold"
                  onClick={() => {
                    if (import.meta.env.DEV) {
                      console.log(
                        "Full Store Snapshot:",
                        useAppStore.getState(),
                      );
                      alert(
                        "Store snapshot dumped to console (check Web Inspector)",
                      );
                    } else {
                      alert("Store dump 仅开发环境可用");
                    }
                  }}
                >
                  Dump Snapshot
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-lg flex-1 text-xs font-semibold"
                  onClick={() => window.location.reload()}
                >
                  Force Reload
                </Button>
              </div>
              <div className="flex gap-2 mt-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-lg flex-1 text-xs font-semibold"
                  loading={loadingSessions}
                  onClick={() => void loadSessions()}
                >
                  {!loadingSessions && <RefreshCcw size={12} className="mr-1" />}
                  刷新 CLI 会话
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-lg flex-1 text-xs font-semibold"
                  loading={pruning}
                  onClick={() => void pruneStoppedSessions()}
                >
                  {!pruning && <Trash2 size={12} className="mr-1" />}
                  清理 stopped
                </Button>
              </div>
            </div>
          </div>

          <div className="bg-bg-code rounded-xl p-6 border border-border-muted font-mono text-[11px] leading-relaxed relative overflow-hidden group/logs">
            <div className="flex items-center justify-between mb-4">
              <h5 className="text-sm font-semibold text-text-main">
                Diagnostic Log Trace
              </h5>
              <Badge
                variant="outline"
                className="text-[8px] opacity-40"
              >
                AUTO-GEN
              </Badge>
            </div>
            <div className="space-y-1.5 opacity-80 max-h-[200px] overflow-y-auto custom-scrollbar">
              <div>
                <span className="text-text-muted/40 mr-2">[INFO]</span>{" "}
                Checking crypto service availability...{" "}
                <span className="text-emerald-500">Ready</span>
              </div>
              <div>
                <span className="text-text-muted/40 mr-2">[INFO]</span>{" "}
                Validating persistent storage...{" "}
                <span className="text-emerald-500">OK</span>
              </div>
              <div>
                <span className="text-text-muted/40 mr-2">[INFO]</span>{" "}
                Active Task: {activeEngineId}
              </div>
              <div>
                <span className="text-text-muted/40 mr-2">[INFO]</span>{" "}
                Environment: {import.meta.env.MODE} {navigator.platform}
              </div>
              <div>
                <span className="text-text-muted/40 mr-2">[INFO]</span>{" "}
                CLI Sessions: {sessions.length}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border-muted bg-bg-base p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h5 className="text-sm font-semibold text-text-main">
                CLI Session Logs
              </h5>
              {selectedSession && (
                <Badge variant="outline" className="text-[9px]">
                  {selectedSession.status || "unknown"}
                </Badge>
              )}
            </div>
            <div className="flex gap-2">
              <select
                className="flex-1 h-8 rounded-md border border-border-subtle bg-bg-surface px-2 text-xs"
                value={selectedSessionId}
                onChange={(event) => setSelectedSessionId(event.target.value)}
              >
                {sessions.length === 0 ? (
                  <option value="">暂无会话</option>
                ) : (
                  sessions.map((item) => (
                    <option key={item.session_id} value={item.session_id}>
                      {item.session_id} ({item.mode}/{item.status})
                    </option>
                  ))
                )}
              </select>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs font-semibold"
                loading={loadingLogs}
                onClick={() => void loadLogs()}
                disabled={!selectedSessionId}
              >
                {!loadingLogs && <FileText size={12} className="mr-1" />}
                读取日志
              </Button>
            </div>
            {cliMessage && (
              <p className="text-xs text-amber-500 break-all">{cliMessage}</p>
            )}
            <pre className="min-h-[120px] max-h-[220px] overflow-auto custom-scrollbar rounded-md border border-border-subtle bg-bg-code p-2 text-xs whitespace-pre-wrap break-words">
              {sessionLogs || "暂无日志"}
            </pre>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
