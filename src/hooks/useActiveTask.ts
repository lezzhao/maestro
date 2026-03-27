import { useEffect, useMemo } from "react";
import { useTaskStoreState } from "./use-app-store-selectors";
import type { AppTask } from "../types";

/**
 * 从 appStore 中获取当前活跃 task，避免在多处重复 tasks.find 逻辑。
 * 使用 useMemo 缓存查找结果，仅在 tasks 或 activeTaskId 变化时重新计算。
 * 并且增加一个防越界的逻辑，如果当前的 task 属于了其他的 workspace，将其重置。
 */
export function useActiveTask(): {
  activeTaskId: string | null;
  activeTask: AppTask | undefined;
} {
  const { tasks, activeTaskId, activeWorkspaceId, setActiveTaskId } = useTaskStoreState();

  const activeTask = useMemo(
    () => tasks.find((t) => t.id === activeTaskId),
    [tasks, activeTaskId],
  );

  useEffect(() => {
    if (activeTask && (activeTask.workspaceId || null) !== (activeWorkspaceId || null)) {
      setActiveTaskId(null);
    }
  }, [activeTask, activeWorkspaceId, setActiveTaskId]);

  return { activeTaskId, activeTask };
}
