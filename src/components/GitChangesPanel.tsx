import { useState } from "react";
import { FileCode2, RefreshCcw, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { cn } from "../lib/utils";
import { useTranslation } from "../i18n";
import type { FileChange } from "../types";

interface Props {
  gitChanges: FileChange[];
  activeFile: string;
  activeDiff: string;
  onFileSelect: (path: string) => void;
  onRefresh: () => Promise<void>;
}

export function GitChangesPanel({ gitChanges, activeFile, activeDiff, onFileSelect, onRefresh }: Props) {
  const { t } = useTranslation();
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 15;

  const totalPages = Math.ceil(gitChanges.length / pageSize) || 1;
  const pagedChanges = gitChanges.slice((page - 1) * pageSize, page * pageSize);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-bg-surface/30 rounded-xl border border-border-muted/20">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-muted/30 bg-bg-elevated/20">
        <div className="flex items-center gap-2">
          <FileCode2 size={14} className="text-primary-500" />
          <span className="text-[11px] font-black uppercase tracking-wider text-text-muted">
            {t("changes")}
          </span>
          <Badge variant="secondary" className="h-4 px-1.5 text-[9px] font-bold">
            {gitChanges.length}
          </Badge>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6 text-text-muted hover:text-text-main"
          disabled={refreshing}
          onClick={handleRefresh}
        >
          <RefreshCcw size={12} className={refreshing ? "animate-spin" : ""} />
        </Button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-2 space-y-1">
        {gitChanges.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center opacity-40 grayscale py-8">
            <FileCode2 size={24} className="mb-2" />
            <span className="text-[10px] uppercase font-bold tracking-widest">{t("no_changes")}</span>
          </div>
        ) : (
          pagedChanges.map((change) => (
            <button
              key={`${change.status}-${change.path}`}
              className={cn(
                "w-full text-left px-2 py-1.5 rounded-md border border-transparent transition-all group",
                activeFile === change.path
                  ? "bg-primary-500/10 border-primary-500/30 text-primary-500"
                  : "hover:bg-bg-subtle/50 text-text-muted hover:text-text-main"
              )}
              onClick={() => onFileSelect(change.path)}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-[11px] font-mono leading-none tracking-tight">
                  {change.path}
                </span>
                <span
                  className={cn(
                    "text-[8px] uppercase font-black px-1 rounded-sm border shrink-0",
                    change.status === "added"
                      ? "text-emerald-500 border-emerald-500/20 bg-emerald-500/5"
                      : change.status === "deleted"
                      ? "text-rose-500 border-rose-500/20 bg-rose-500/5"
                      : "text-amber-500 border-amber-500/20 bg-amber-500/5"
                  )}
                >
                  {change.status.slice(0, 1)}
                </span>
              </div>
            </button>
          ))
        )}
      </div>

      <div className="h-44 border-t border-border-muted/30 bg-bg-base/40 p-2">
        <div className="text-[10px] font-semibold text-text-muted mb-1.5">Diff 预览</div>
        <div className="h-[calc(100%-18px)] overflow-auto custom-scrollbar rounded border border-border-muted/20 bg-bg-surface/20 p-2">
          {activeFile && activeDiff ? (
            <div className="font-mono text-[10px] leading-relaxed select-text">
              {activeDiff.split('\n').map((line, idx) => {
                const isAdded = line.startsWith('+') && !line.startsWith('+++');
                const isRemoved = line.startsWith('-') && !line.startsWith('---');
                const isHeader = line.startsWith('@@') || line.startsWith('diff') || line.startsWith('---') || line.startsWith('+++');
                
                return (
                  <div 
                    key={idx} 
                    className={cn(
                      "whitespace-pre",
                      isAdded ? "text-emerald-500 bg-emerald-500/5" :
                      isRemoved ? "text-rose-500 bg-rose-500/5" :
                      isHeader ? "text-blue-500 opacity-60" : "text-text-main opacity-80"
                    )}
                  >
                    {line}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-[10px] text-text-muted italic flex items-center justify-center h-full">
              请选择文件查看 diff 预览。
            </div>
          )}
        </div>
      </div>

      {totalPages > 1 && (
        <div className="px-2 py-1.5 border-t border-border-muted/30 bg-bg-elevated/10 flex items-center justify-between">
          <span className="text-[9px] font-bold text-text-muted uppercase">
            {page} / {totalPages}
          </span>
          <div className="flex gap-1">
            <Button
              size="icon"
              variant="ghost"
              className="h-5 w-5"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft size={12} />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-5 w-5"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight size={12} />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
