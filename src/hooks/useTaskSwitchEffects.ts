import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { recordPerf } from "../lib/utils/perf";

type TaskSwitchEffectsParams = {
  activeTaskId: string | null;
  activeTaskMessagesLength: number;
  projectPath: string;
  latestRunId?: string;
  latestRunStatus?: string;
  setActiveFile: (path: string) => void;
  setActiveDiff: (diff: string) => void;
  refreshGitStatus: (options?: { force?: boolean }) => Promise<void>;
};

export function useTaskSwitchEffects({
  activeTaskId,
  activeTaskMessagesLength,
  projectPath,
  latestRunId,
  latestRunStatus,
  setActiveFile,
  setActiveDiff,
  refreshGitStatus,
}: TaskSwitchEffectsParams) {
  const taskSwitchStartRef = useRef<number>(performance.now());

  useEffect(() => {
    taskSwitchStartRef.current = performance.now();
  }, [activeTaskId]);

  useEffect(() => {
    const duration = performance.now() - taskSwitchStartRef.current;
    recordPerf("workspace_task_switch", duration, {
      taskId: activeTaskId || "none",
      messageCount: activeTaskMessagesLength,
    });
  }, [activeTaskId, activeTaskMessagesLength]);

  useEffect(() => {
    setActiveFile("");
    setActiveDiff("");
  }, [activeTaskId, setActiveDiff, setActiveFile]);

  useEffect(() => {
    if (!projectPath || !activeTaskId) return;
    void refreshGitStatus({ force: true });
  }, [activeTaskId, projectPath, refreshGitStatus]);

  // File Watcher Lifecycle Management
  // Only runs when there's an active running task.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const isRunning = latestRunStatus === "running" || latestRunStatus === "pending";
    
    if (isRunning && projectPath && activeTaskId) {
      // Start watcher on backend
      invoke("file_watcher_start", { path: projectPath })
        .then(() => {
          // Listen for file changes
          listen("project_files_changed", () => {
            void refreshGitStatus({ force: true });
          }).then((fn) => { unlisten = fn; });
        })
        .catch((err) => console.error("Failed to start file watcher:", err));
    }
    
    return () => {
      // Stop watcher
      invoke("file_watcher_stop").catch(() => {});
      if (unlisten) unlisten();
    };
  }, [activeTaskId, latestRunStatus, projectPath, refreshGitStatus]);

  useEffect(() => {
    const status = latestRunStatus;
    if (!projectPath || !activeTaskId || !status) return;
    if (status === "done" || status === "error" || status === "stopped") {
      void refreshGitStatus({ force: true });
    }
  }, [activeTaskId, latestRunId, latestRunStatus, projectPath, refreshGitStatus]);
}
