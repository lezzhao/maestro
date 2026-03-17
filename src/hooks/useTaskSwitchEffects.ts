import { useEffect, useRef } from "react";
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

  useEffect(() => {
    const status = latestRunStatus;
    if (!projectPath || !activeTaskId || !status) return;
    if (status === "done" || status === "error" || status === "stopped") {
      void refreshGitStatus({ force: true });
    }
  }, [activeTaskId, latestRunId, latestRunStatus, projectPath, refreshGitStatus]);
}
