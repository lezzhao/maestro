import { useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  EngineHistoryDetail,
  EngineHistoryPage,
  WorkflowArchiveEntry,
  WorkflowArchiveDetail,
  WorkflowArchiveExportResult,
  WorkflowFullArchive,
} from "../types";

export function useWorkflow() {
  const archiveListCacheRef = useRef<{ value: WorkflowArchiveEntry[]; ts: number } | null>(null);
  const archiveDetailCacheRef = useRef<Map<string, WorkflowArchiveDetail>>(new Map());
  const fullArchiveCacheRef = useRef<Map<string, WorkflowFullArchive>>(new Map());
  const historyPageCacheRef = useRef<Map<string, EngineHistoryPage>>(new Map());
  const historyDetailCacheRef = useRef<Map<string, EngineHistoryDetail>>(new Map());

  const listArchives = async (options?: { force?: boolean }) => {
    const now = Date.now();
    const ttlMs = 10_000;
    if (
      !options?.force &&
      archiveListCacheRef.current &&
      now - archiveListCacheRef.current.ts <= ttlMs
    ) {
      return archiveListCacheRef.current.value;
    }
    const value = await invoke<WorkflowArchiveEntry[]>("workflow_list_archives");
    archiveListCacheRef.current = { value, ts: now };
    return value;
  };

  const getArchiveDetail = async (archivePath: string, options?: { force?: boolean }) => {
    if (!options?.force && archiveDetailCacheRef.current.has(archivePath)) {
      return archiveDetailCacheRef.current.get(archivePath)!;
    }
    const value = await invoke<WorkflowArchiveDetail>("workflow_get_archive", {
      archivePath,
    });
    archiveDetailCacheRef.current.set(archivePath, value);
    return value;
  };

  const getFullArchive = async (archivePath: string, options?: { force?: boolean }) => {
    if (!options?.force && fullArchiveCacheRef.current.has(archivePath)) {
      return fullArchiveCacheRef.current.get(archivePath)!;
    }
    const value = await invoke<WorkflowFullArchive>("workflow_get_full_archive", {
      archivePath,
    });
    fullArchiveCacheRef.current.set(archivePath, value);
    return value;
  };

  const exportArchives = async (entries: WorkflowArchiveEntry[]) =>
    invoke<WorkflowArchiveExportResult>("workflow_export_archives", { entries });

  const listEngineHistory = async (
    engineId?: string,
    page = 1,
    pageSize = 20,
    options?: { force?: boolean },
  ) => {
    const cacheKey = `${engineId || "__all__"}:${page}:${pageSize}`;
    if (!options?.force && historyPageCacheRef.current.has(cacheKey)) {
      return historyPageCacheRef.current.get(cacheKey)!;
    }
    const value = await invoke<EngineHistoryPage>("workflow_list_engine_history", {
      engineId: engineId ?? null,
      page,
      pageSize,
    });
    historyPageCacheRef.current.set(cacheKey, value);
    return value;
  };

  const getEngineHistoryDetail = async (
    detailPath: string,
    options?: { force?: boolean },
  ) => {
    if (!options?.force && historyDetailCacheRef.current.has(detailPath)) {
      return historyDetailCacheRef.current.get(detailPath)!;
    }
    const value = await invoke<EngineHistoryDetail>("workflow_get_engine_history_detail", {
      detailPath,
    });
    historyDetailCacheRef.current.set(detailPath, value);
    return value;
  };

  return {
    listArchives,
    getArchiveDetail,
    getFullArchive,
    exportArchives,
    listEngineHistory,
    getEngineHistoryDetail,
  };
}
