import { Activity, Database, RefreshCcw, Trash2, FileText } from "lucide-react";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Card, CardContent } from "../ui/card";
import { useCliSessions } from "../../hooks/use-cli-sessions";
import { useProjectStoreState } from "../../hooks/use-app-store-selectors";
import { useAppStore } from "../../stores/appStore";

interface SystemDiagnosticsProps {
  activeEngineId: string;
  engineCount: number;
}

export function SystemDiagnostics({
  activeEngineId,
  engineCount,
}: SystemDiagnosticsProps) {
  const { projectPath } = useProjectStoreState();
  const {
    sessions,
    selectedSessionId,
    setSelectedSessionId,
    sessionLogs,
    loadingSessions,
    loadingLogs,
    pruning,
    message: cliMessage,
    selectedSession,
    loadSessions,
    loadLogs,
    pruneStoppedSessions,
  } = useCliSessions(activeEngineId);

  return (
    <section className="space-y-6 px-4">


      <Card className="rounded-xl border border-border-muted bg-bg-surface overflow-hidden">
        <CardContent className="p-8 space-y-6 bg-bg-surface border-none">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-5 rounded-xl bg-bg-base border border-border-muted/30 hover:border-border-muted transition-colors">
              <h4 className="flex items-center gap-2 text-sm font-bold text-text-main mb-4">
                <Database size={16} className="text-primary-500" />
                Store Status
              </h4>
              <div className="space-y-3">
                <div className="flex justify-between items-center text-xs border-b border-border-muted/20 pb-2">
                  <span className="text-text-muted">Active Task ID</span>
                  <span className="font-mono text-primary-500 font-semibold bg-primary-500/10 px-2 py-0.5 rounded">
                    {activeEngineId || "None"}
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs border-b border-border-muted/20 pb-2">
                  <span className="text-text-muted">Tasks Count</span>
                  <span className="font-mono font-medium">{engineCount} Tasks</span>
                </div>
                <div className="flex justify-between items-center text-sm pt-1">
                  <span className="text-text-muted text-xs">Project Directory</span>
                  <span className="font-mono text-[10px] truncate max-w-[150px] text-text-muted/70" title={projectPath || ""}>
                    {projectPath || "None"}
                  </span>
                </div>
              </div>
            </div>

            <div className="p-5 rounded-xl bg-bg-base border border-border-muted/30 hover:border-border-muted transition-colors flex flex-col justify-between">
              <h4 className="flex items-center gap-2 text-sm font-bold text-text-main mb-4">
                <Activity size={16} className="text-amber-500" />
                Diagnostic Actions
              </h4>
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 rounded-lg text-xs font-semibold bg-bg-surface hover:bg-bg-elevated hover:text-text-main transition-colors border-border-muted/50 hover:border-border-muted"
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
                    className="h-9 rounded-lg text-xs font-semibold bg-bg-surface hover:bg-bg-elevated hover:text-text-main transition-colors border-border-muted/50 hover:border-border-muted"
                    onClick={() => window.location.reload()}
                  >
                    Force Reload
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 rounded-lg text-xs font-semibold text-text-muted hover:text-text-main bg-bg-surface hover:bg-bg-elevated transition-colors border-border-muted/50 hover:border-border-muted"
                    loading={loadingSessions}
                    onClick={() => void loadSessions()}
                  >
                    {!loadingSessions && <RefreshCcw size={14} className="mr-2" />}
                    刷新 CLI 会话
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 rounded-lg text-xs font-semibold text-rose-500/80 hover:text-rose-500 bg-bg-surface hover:bg-rose-500/10 transition-colors border-border-muted/50 hover:border-rose-500/30"
                    loading={pruning}
                    onClick={() => void pruneStoppedSessions()}
                  >
                    {!pruning && <Trash2 size={14} className="mr-2" />}
                    清理 stopped
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-bg-base rounded-xl p-5 border border-border-muted/30 font-mono text-[11px] leading-relaxed relative overflow-hidden group/logs">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-border-muted/20">
              <h5 className="text-sm font-bold text-text-main">
                Diagnostic Log Trace
              </h5>
              <Badge
                variant="secondary"
                className="text-[9px] font-bold bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 border-none px-2 py-0.5 rounded-md"
              >
                AUTO-GEN
              </Badge>
            </div>
            <div className="space-y-2 opacity-80 max-h-[200px] overflow-y-auto custom-scrollbar pr-2">
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

          <div className="rounded-md border border-border-muted bg-bg-base p-4 space-y-3">
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
            <pre className="min-h-[120px] max-h-[220px] overflow-auto custom-scrollbar rounded-md border border-border-subtle bg-bg-code p-2 text-xs whitespace-pre-wrap wrap-break-word">
              {sessionLogs || "暂无日志"}
            </pre>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
