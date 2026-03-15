import { useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../stores/appStore";
import type {
  EngineRecommendation,
  FileChange,
  ProjectSetResult,
  ProjectStackResult,
} from "../types";

export function useProject() {
  const projectPath = useAppStore((s) => s.projectPath);
  const setProjectPath = useAppStore((s) => s.setProjectPath);
  const setActiveEngineId = useAppStore((s) => s.setActiveEngineId);
  const gitStatusCacheRef = useRef<Map<string, { value: FileChange[]; ts: number }>>(
    new Map(),
  );
  const gitDiffCacheRef = useRef<Map<string, { value: string; ts: number }>>(new Map());

  const detectAndRecommend = useCallback(
    async (path: string) => {
      const stack = await invoke<ProjectStackResult>("project_detect_stack", {
        projectPath: path,
      });
      await invoke<ProjectSetResult>("project_set_current", {
        projectPath: path,
      });
      const recommendation = await invoke<EngineRecommendation>(
        "project_recommend_engine",
        { projectPath: path },
      );
      setProjectPath(path);
      setActiveEngineId(recommendation.engine_id);
      return { stack, recommendation };
    },
    [setActiveEngineId, setProjectPath],
  );

  const gitStatus = useCallback(
    async (path = projectPath, options?: { force?: boolean }) => {
      if (!path) return [];
      const cacheKey = path;
      const ttlMs = 15_000;
      const now = Date.now();
      const cached = gitStatusCacheRef.current.get(cacheKey);
      if (!options?.force && cached && now - cached.ts <= ttlMs) {
        return cached.value;
      }
      const value = await invoke<FileChange[]>("project_git_status", { projectPath: path });
      gitStatusCacheRef.current.set(cacheKey, { value, ts: now });
      return value;
    },
    [projectPath],
  );

  const gitDiff = useCallback(
    async (filePath?: string, path = projectPath, options?: { force?: boolean }) => {
      if (!path) return "";
      const cacheKey = `${path}::${filePath || "__all__"}`;
      const ttlMs = 15_000;
      const now = Date.now();
      const cached = gitDiffCacheRef.current.get(cacheKey);
      if (!options?.force && cached && now - cached.ts <= ttlMs) {
        return cached.value;
      }
      const value = await invoke<string>("project_git_diff", {
        projectPath: path,
        filePath: filePath ?? null,
      });
      gitDiffCacheRef.current.set(cacheKey, { value, ts: now });
      return value;
    },
    [projectPath],
  );

  const readProjectFile = useCallback(
    async (filePath: string, path = projectPath, maxChars = 20_000) => {
      if (!path) return "";
      return invoke<string>("project_read_file", {
        projectPath: path,
        filePath,
        maxChars,
      });
    },
    [projectPath],
  );

  return {
    projectPath,
    setProjectPath,
    detectAndRecommend,
    gitStatus,
    gitDiff,
    readProjectFile,
  };
}
