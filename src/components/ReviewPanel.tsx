import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Archive, Download, FileCode2, MessageSquareText, RefreshCcw, Search } from "lucide-react";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Select } from "./ui/select";
import type {
  EngineHistoryDetail,
  EngineHistoryEntry,
  EngineHistoryPage,
  FileChange,
  WorkflowArchiveDetail,
  WorkflowArchiveEntry,
} from "../types";
import { cn } from "../lib/utils";
import { useTranslation } from "../i18n";

type Props = {
  projectPath: string;
  archives: WorkflowArchiveEntry[];
  archiveDetail: WorkflowArchiveDetail | null;
  gitChanges: FileChange[];
  gitDiff: string;
  onRefreshArchives: () => Promise<void>;
  onLoadArchiveDetail: (archivePath: string) => Promise<void>;
  onExportArchives: (entries: WorkflowArchiveEntry[]) => Promise<string>;
  onRefreshGitStatus: (options?: { force?: boolean }) => Promise<void>;
  onLoadGitDiff: (filePath?: string, options?: { force?: boolean }) => Promise<void>;
  onListEngineHistory: (
    engineId?: string,
    page?: number,
    pageSize?: number,
  ) => Promise<EngineHistoryPage>;
  onGetEngineHistoryDetail: (detailPath: string) => Promise<EngineHistoryDetail>;
  activeEngineId: string;
  onGoCompose: () => void;
};

export function ReviewPanel({
  projectPath,
  archives,
  archiveDetail,
  gitChanges,
  gitDiff,
  onRefreshArchives,
  onLoadArchiveDetail,
  onExportArchives,
  onRefreshGitStatus,
  onLoadGitDiff,
  onListEngineHistory,
  onGetEngineHistoryDetail,
  activeEngineId,
  onGoCompose,
}: Props) {
  const [tab, setTab] = useState<"diff" | "chat" | "archive">("diff");
  const [activeFile, setActiveFile] = useState<string>("");
  const [history, setHistory] = useState<EngineHistoryEntry[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize] = useState(12);
  const [historyEngine, setHistoryEngine] = useState<string>("all");
  const [historyDetail, setHistoryDetail] = useState<EngineHistoryDetail | null>(null);
  const [selectedHistoryEntry, setSelectedHistoryEntry] = useState<EngineHistoryEntry | null>(null);
  const [archiveQuery, setArchiveQuery] = useState("");
  const deferredArchiveQuery = useDeferredValue(archiveQuery);
  const [archiveStatus, setArchiveStatus] = useState<"all" | "completed" | "failed">("all");
  const [archivePage, setArchivePage] = useState(1);
  const archivePageSize = 10;
  const [selectedArchivePath, setSelectedArchivePath] = useState<string>("");
  const [refreshingGit, setRefreshingGit] = useState(false);
  const [refreshingArchives, setRefreshingArchives] = useState(false);
  const [exportingArchives, setExportingArchives] = useState(false);
  const [gitPage, setGitPage] = useState(1);
  const gitPageSize = 20;

  const [loadingHistory, setLoadingHistory] = useState(false);
  const { t } = useTranslation();

  const formatTime = (ts: number) =>
    new Date(ts * 1000).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

  const loadHistory = async (engineId = historyEngine, page = historyPage) => {
    setLoadingHistory(true);
    try {
      const result = await onListEngineHistory(
        engineId === "all" ? undefined : engineId,
        page,
        historyPageSize,
      );
      setHistory(result.entries);
      setHistoryTotal(result.total);
      setHistoryPage(result.page);
      if (result.entries.length === 0) {
        setSelectedHistoryEntry(null);
        setHistoryDetail(null);
        return;
      }
      const current = selectedHistoryEntry;
      const exists = current && result.entries.some((x) => x.id === current.id);
      const next = exists
        ? result.entries.find((x) => x.id === current!.id) || result.entries[0]
        : result.entries[0];
      setSelectedHistoryEntry(next);
      if (!current || current.id !== next.id) {
        const detail = await onGetEngineHistoryDetail(next.detail_path);
        setHistoryDetail(detail);
      }
    } finally {
      setLoadingHistory(false);
    }
  };

  const loadHistoryDetail = async (entry: EngineHistoryEntry) => {
    setSelectedHistoryEntry(entry);
    const detail = await onGetEngineHistoryDetail(entry.detail_path);
    setHistoryDetail(detail);
  };

  useEffect(() => {
    if (tab === "chat") {
      void loadHistory("all", 1);
    }
  }, [tab]);

  useEffect(() => {
    if (tab === "archive" && archives.length > 0 && !selectedArchivePath) {
      setSelectedArchivePath(archives[0].path);
    }
  }, [archives, selectedArchivePath, tab]);

  const filteredArchives = useMemo(() => {
    const query = deferredArchiveQuery.trim().toLowerCase();
    return archives.filter((entry) => {
      const matchQuery =
        !query ||
        entry.name.toLowerCase().includes(query) ||
        entry.workflow_name.toLowerCase().includes(query);
      if (!matchQuery) return false;
      if (archiveStatus === "completed") return entry.completed;
      if (archiveStatus === "failed") return !entry.completed || entry.failed_count > 0;
      return true;
    });
  }, [deferredArchiveQuery, archiveStatus, archives]);

  const pagedArchives = useMemo(() => {
    const start = (archivePage - 1) * archivePageSize;
    return filteredArchives.slice(start, start + archivePageSize);
  }, [filteredArchives, archivePage, archivePageSize]);

  useEffect(() => {
    setArchivePage(1);
  }, [deferredArchiveQuery, archiveStatus]);

  const tabButton = (
    id: "diff" | "chat" | "archive",
    label: string,
    Icon: typeof FileCode2,
  ) => (
    <Button
      variant="ghost"
      size="sm"
      className={cn(
        "h-8 gap-1.5",
        tab === id
          ? "bg-primary-500/15 text-primary-400 ring-1 ring-primary-500/20"
          : "text-text-muted",
      )}
      onClick={() => setTab(id)}
    >
      <Icon size={14} />
      {label}
    </Button>
  );

  if (!projectPath && tab === "diff") {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-sm text-text-muted">{t("no_project_review")}</p>
          <Button onClick={onGoCompose}>{t("nav_compose")}</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-5 animate-in fade-in duration-300">
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          {tabButton("diff", t("git_diff"), FileCode2)}
          {tabButton("chat", t("chat_logs"), MessageSquareText)}
          {tabButton("archive", t("archive_tab"), Archive)}
        </div>
        {tab === "diff" && (
          <Button
            size="sm"
            variant="outline"
            loading={refreshingGit}
            onClick={async () => {
              setRefreshingGit(true);
              try {
                await onRefreshGitStatus({ force: true });
                await onLoadGitDiff(undefined, { force: true });
              } finally {
                setRefreshingGit(false);
              }
            }}
          >
            {!refreshingGit && <RefreshCcw size={13} />}
            {t("refresh")}
          </Button>
        )}
      </div>

      {tab === "diff" && (
        <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-12 gap-4">
          <Card className="xl:col-span-4 border-border-muted/60 flex flex-col min-h-0">
            <CardHeader className="pb-3 shrink-0">
              <CardTitle className="text-sm">{t("changes")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 flex-1 flex flex-col min-h-0">
              <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2">
                {gitChanges.length === 0 ? (
                  <span className="text-xs text-text-muted">{t("no_changes")}</span>
                ) : (
                  gitChanges.slice((gitPage - 1) * gitPageSize, gitPage * gitPageSize).map((change) => (
                    <button
                      type="button"
                      key={`${change.status}-${change.path}`}
                      className={cn(
                        "w-full text-left p-2 rounded-md border border-border-subtle hover:border-primary-500/30",
                        activeFile === change.path && "bg-primary-500/10 border-primary-500/40",
                      )}
                      onClick={() => {
                        setActiveFile(change.path);
                        void onLoadGitDiff(change.path);
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-mono">{change.path}</span>
                        <Badge
                          variant={
                            change.status === "added"
                              ? "success"
                              : change.status === "deleted"
                                ? "destructive"
                                : "warning"
                          }
                        >
                          {change.status}
                        </Badge>
                      </div>
                    </button>
                  ))
                )}
              </div>
              {gitChanges.length > gitPageSize && (
                <div className="flex items-center justify-between pt-2 border-t border-border-muted/5 shrink-0">
                  <span className="text-[10px] text-text-muted">
                    {gitPage} / {Math.ceil(gitChanges.length / gitPageSize)}
                  </span>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" className="h-6 text-[10px]" disabled={gitPage <= 1} onClick={() => setGitPage(p => p - 1)}>{t("prev_page")}</Button>
                    <Button size="sm" variant="ghost" className="h-6 text-[10px]" disabled={gitPage * gitPageSize >= gitChanges.length} onClick={() => setGitPage(p => p + 1)}>{t("next_page")}</Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="xl:col-span-8 border-border-muted/60 flex flex-col min-h-0">
            <CardHeader className="pb-3 shrink-0">
              <CardTitle className="text-sm">{t("diff_preview")}</CardTitle>
            </CardHeader>
            <CardContent className="flex-1 min-h-0 flex flex-col">
              <pre className="flex-1 text-xs font-mono leading-relaxed whitespace-pre-wrap wrap-break-word overflow-auto custom-scrollbar bg-bg-base/50 border border-border-subtle rounded-md p-4">
                {gitDiff || t("select_file_diff")}
              </pre>
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "chat" && (
        <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-12 gap-4">
          <Card className="xl:col-span-4 border-border-muted/60 flex flex-col min-h-0">
            <CardHeader className="pb-3 shrink-0">
              <CardTitle className="text-sm">{t("engine_history")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 flex-1 flex flex-col min-h-0">
              <div className="flex items-center gap-2 shrink-0">
                <Select
                  value={historyEngine}
                  options={[
                    { value: "all", label: t("all_engines") },
                    { value: activeEngineId, label: `${t("current_engine")}: ${activeEngineId}` },
                  ]}
                  onChange={(val) => {
                    setHistoryEngine(val);
                    setHistoryPage(1);
                    void loadHistory(val, 1);
                  }}
                />
                <Button
                  size="sm"
                  variant="outline"
                  loading={loadingHistory}
                  onClick={() => void loadHistory()}
                >
                  {!loadingHistory && <RefreshCcw size={13} />}
                </Button>
              </div>
              <div className="space-y-2 flex-1 overflow-y-auto custom-scrollbar">
                {history.length === 0 ? (
                  <p className="text-xs text-text-muted">{t("no_history")}</p>
                ) : (
                  history.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      className={cn(
                        "w-full text-left p-2 rounded-md border border-border-subtle hover:border-primary-500/30",
                        selectedHistoryEntry?.id === item.id &&
                          "bg-primary-500/10 border-primary-500/40",
                      )}
                      onClick={() => void loadHistoryDetail(item)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[11px] font-semibold truncate">
                          {item.workflow_name} · #{item.step_index + 1}
                        </div>
                        <Badge
                          variant={item.success && item.completion_matched ? "success" : "warning"}
                          className="h-4 px-1 text-[9px] font-bold"
                        >
                          {item.success && item.completion_matched ? "OK" : "WARN"}
                        </Badge>
                      </div>
                      <div className="text-[10px] text-text-muted mt-1 flex items-center justify-between gap-2">
                        <span className="truncate">{item.summary}</span>
                        <span className="shrink-0">{formatTime(item.created_ts)}</span>
                      </div>
                    </button>
                  ))
                )}
              </div>
              <div className="flex items-center justify-between shrink-0">
                <span className="text-[10px] text-text-muted">
                  {t("page_count", {
                    p: historyPage,
                    t: Math.ceil(historyTotal / historyPageSize),
                    total: historyTotal
                  })}
                </span>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={historyPage <= 1}
                    onClick={() => void loadHistory(historyEngine, Math.max(1, historyPage - 1))}
                  >
                    {t("prev_page")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={historyPage * historyPageSize >= historyTotal}
                    onClick={() => void loadHistory(historyEngine, historyPage + 1)}
                  >
                    {t("next_page")}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="xl:col-span-8 border-border-muted/60 flex flex-col min-h-0">
            <CardHeader className="pb-3 shrink-0">
              <CardTitle className="text-sm">{t("dialog_detail")}</CardTitle>
            </CardHeader>
            <CardContent className="flex-1 min-h-0 flex flex-col">
              {!historyDetail ? (
                <p className="text-xs text-text-muted">{t("select_record_prompt")}</p>
              ) : (
                <div className="space-y-3 flex-1 overflow-y-auto custom-scrollbar">
                  <div className="flex justify-end">
                    <div className="max-w-[80%] bg-primary-500/15 border border-primary-500/20 rounded-xl px-3 py-2 text-xs leading-relaxed">
                      <div className="text-[10px] uppercase tracking-wider text-primary-400 mb-1">
                        {t("prompt")} · {historyDetail.engine_id}/{historyDetail.profile_id}
                      </div>
                      {historyDetail.prompt || `(${t("none_label")})`}
                    </div>
                  </div>
                  <div className="flex justify-start">
                    <div className="max-w-[90%] bg-bg-base/60 border border-border-subtle rounded-xl px-3 py-2 text-xs leading-relaxed font-mono whitespace-pre-wrap">
                      <div className="text-[10px] uppercase tracking-wider text-text-muted mb-1">
                        {t("output")}
                      </div>
                      {historyDetail.output ||
                        selectedHistoryEntry?.summary ||
                        `(${t("none_label")})`}
                    </div>
                  </div>
                  {!historyDetail.output && selectedHistoryEntry && (
                    <p className="text-[11px] text-amber-500">
                      {t("no_full_output")}
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "archive" && (
        <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-12 gap-4">
          <Card className="xl:col-span-5 border-border-muted/60 flex flex-col min-h-0">
            <CardHeader className="pb-3 shrink-0">
              <CardTitle className="text-sm">{t("archive_list_title")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 flex-1 min-h-0 flex flex-col">
              <div className="grid grid-cols-1 md:grid-cols-12 gap-2 shrink-0">
                <div className="md:col-span-6 relative">
                  <Search
                    size={13}
                    className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted"
                  />
                  <input
                    value={archiveQuery}
                    onChange={(event) => setArchiveQuery(event.target.value)}
                    placeholder={t("archive_search_placeholder")}
                    className="w-full h-8 rounded-md border border-border-subtle bg-bg-base/60 pl-7 pr-2 text-xs"
                  />
                </div>
                <div className="md:col-span-4">
                  <Select
                    value={archiveStatus}
                    options={[
                      { value: "all", label: t("all_status") },
                      { value: "completed", label: t("completed_label") },
                      { value: "failed", label: t("reason_failed") },
                    ]}
                    onChange={(value) =>
                      setArchiveStatus(value as "all" | "completed" | "failed")
                    }
                  />
                </div>
                <div className="md:col-span-2 flex items-center justify-end gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    loading={refreshingArchives}
                    onClick={async () => {
                      setRefreshingArchives(true);
                      try {
                        await onRefreshArchives();
                      } finally {
                        setRefreshingArchives(false);
                      }
                    }}
                  >
                    {!refreshingArchives && <RefreshCcw size={12} />}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    loading={exportingArchives}
                    onClick={async () => {
                      setExportingArchives(true);
                      try {
                        await onExportArchives(filteredArchives);
                      } finally {
                        setExportingArchives(false);
                      }
                    }}
                  >
                    {!exportingArchives && <Download size={12} />}
                  </Button>
                </div>
              </div>

              <div className="space-y-2 flex-1 overflow-y-auto custom-scrollbar" style={{ willChange: "scroll-position" }}>
                {pagedArchives.length === 0 ? (
                  <p className="text-xs text-text-muted">{t("no_archives")}</p>
                ) : (
                  pagedArchives.map((entry) => (
                    <button
                      type="button"
                      key={entry.path}
                      className={cn(
                        "w-full text-left p-2 rounded-md border border-border-subtle hover:border-primary-500/30 transition-all",
                        selectedArchivePath === entry.path &&
                          "bg-primary-500/10 border-primary-500/40",
                      )}
                      onClick={() => {
                        setSelectedArchivePath(entry.path);
                        void onLoadArchiveDetail(entry.path);
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs font-semibold truncate">
                          {entry.workflow_name || entry.name}
                        </div>
                        <Badge
                          variant={entry.completed && entry.failed_count === 0 ? "success" : "warning"}
                          className="h-4 px-1 text-[9px]"
                        >
                          {entry.completed && entry.failed_count === 0 ? "OK" : "WARN"}
                        </Badge>
                      </div>
                      <div className="text-[10px] mt-1 text-text-muted flex items-center justify-between gap-2">
                        <span className="truncate">{entry.name}</span>
                        <span>{new Date(entry.modified_ts * 1000).toLocaleDateString()}</span>
                      </div>
                    </button>
                  ))
                )}
              </div>
              
              <div className="flex items-center justify-between pt-2 shrink-0 border-t border-border-muted/5">
                <span className="text-[10px] text-text-muted">
                   {archivePage} / {Math.ceil(filteredArchives.length / archivePageSize) || 1}
                </span>
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-[10px]"
                    disabled={archivePage <= 1}
                    onClick={() => setArchivePage(Math.max(1, archivePage - 1))}
                  >
                    {t("prev_page")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-[10px]"
                    disabled={archivePage * archivePageSize >= filteredArchives.length}
                    onClick={() => setArchivePage(archivePage + 1)}
                  >
                    {t("next_page")}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="xl:col-span-7 border-border-muted/60 flex flex-col min-h-0">
            <CardHeader className="pb-3 shrink-0">
              <CardTitle className="text-sm">{t("archive_detail_title")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 flex-1 min-h-0 overflow-y-auto custom-scrollbar">
              {!archiveDetail ? (
                <p className="text-xs text-text-muted">{t("select_archive_prompt")}</p>
              ) : (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <div className="rounded-md border border-border-subtle p-2">
                      <div className="text-[10px] text-text-muted">Workflow</div>
                      <div className="text-xs font-semibold truncate">
                        {archiveDetail.workflow_name || archiveDetail.name}
                      </div>
                    </div>
                    <div className="rounded-md border border-border-subtle p-2">
                      <div className="text-[10px] text-text-muted">{t("status_label")}</div>
                      <div className="text-xs font-semibold">
                        {archiveDetail.completed ? t("completed_label") : t("incomplete")}
                      </div>
                    </div>
                    <div className="rounded-md border border-border-subtle p-2">
                      <div className="text-[10px] text-text-muted">步骤</div>
                      <div className="text-xs font-semibold">{archiveDetail.step_count}</div>
                    </div>
                    <div className="rounded-md border border-border-subtle p-2">
                      <div className="text-[10px] text-text-muted">{t("reason_failed")}</div>
                      <div className="text-xs font-semibold">{archiveDetail.failed_count}</div>
                    </div>
                  </div>

                  <div className="rounded-md border border-border-subtle p-2">
                    <div className="text-[10px] text-text-muted mb-2">{t("failed_steps_label")}</div>
                    {archiveDetail.failed_steps.length === 0 ? (
                      <p className="text-xs text-text-muted">{t("no_failed_steps_label")}</p>
                    ) : (
                      <div className="space-y-2">
                        {archiveDetail.failed_steps.map((step) => (
                          <div
                            key={`${step.index}-${step.engine}-${step.mode}`}
                            className="text-xs rounded border border-border-subtle p-2"
                          >
                            <div className="font-semibold">
                              Step #{step.index + 1} · {step.engine} · {step.mode}
                            </div>
                            <div className="text-text-muted mt-1">
                              {step.status} / {step.reason}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
