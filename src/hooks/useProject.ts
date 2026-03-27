import { useCallback, useRef } from "react";
import { useProjectStoreState } from "./use-app-store-selectors";
import {
  detectProjectStackCommand,
  getProjectGitDiffCommand,
  getProjectGitStatusCommand,
  readProjectFileCommand,
  recommendProjectEngineCommand,
  setCurrentProjectCommand,
} from "./project-commands";
import { loadProjectGitDiff, loadProjectGitStatus } from "./project-cache-support";
import type { FileChange } from "../types";

export function useProject() {
  const { projectPath, setProjectPath } = useProjectStoreState();
  const gitStatusCacheRef = useRef<Map<string, { value: FileChange[]; ts: number }>>(
    new Map(),
  );
  const gitDiffCacheRef = useRef<Map<string, { value: string; ts: number }>>(new Map());

  const detectAndRecommend = useCallback(
    async (path: string) => {
      const stack = await detectProjectStackCommand(path);
      await setCurrentProjectCommand(path);
      // Set path immediately after setting the current project in backend
      setProjectPath(path);
      
      const recommendation = await recommendProjectEngineCommand(path);
      return { stack, recommendation };
    },
    [setProjectPath],
  );

  const gitStatus = useCallback(
    async (path = projectPath, options?: { force?: boolean }) => {
      if (!path) return [];
      return loadProjectGitStatus({
        projectPath: path,
        force: options?.force ?? false,
        cache: gitStatusCacheRef.current,
        fetchStatus: getProjectGitStatusCommand,
      });
    },
    [projectPath],
  );

  const gitDiff = useCallback(
    async (filePath?: string, path = projectPath, options?: { force?: boolean }) => {
      if (!path) return "";
      return loadProjectGitDiff({
        projectPath: path,
        filePath,
        force: options?.force ?? false,
        cache: gitDiffCacheRef.current,
        fetchDiff: getProjectGitDiffCommand,
      });
    },
    [projectPath],
  );

  const readProjectFile = useCallback(
    async (filePath: string, path = projectPath, maxChars = 20_000) => {
      if (!path) return "";
      return readProjectFileCommand(path, filePath, maxChars);
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
