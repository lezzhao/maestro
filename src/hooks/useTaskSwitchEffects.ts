import { useEffect, useRef } from "react";
import { recordPerf } from "../lib/utils/perf";

type TaskSwitchEffectsParams = {
  activeTaskId: string | null;
  activeTaskMessagesLength: number;
  setActiveFile: (path: string) => void;
  setActiveDiff: (diff: string) => void;
};

export function useTaskSwitchEffects({
  activeTaskId,
  activeTaskMessagesLength,
  setActiveFile,
  setActiveDiff,
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
}
