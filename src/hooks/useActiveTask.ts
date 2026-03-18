import { useMemo } from "react";
import { useAppStore } from "../stores/appStore";
import type { AppTask } from "../types";

/**
 * 从 appStore 中获取当前活跃 task，避免在多处重复 tasks.find 逻辑。
 * 使用 useMemo 缓存查找结果，仅在 tasks 或 activeTaskId 变化时重新计算。
 * 更新 task 请使用 updateTaskRecord + updateTaskRuntimeBinding 分层 API。
 */
export function useActiveTask(): {
  activeTaskId: string | null;
  activeTask: AppTask | undefined;
} {
  const tasks = useAppStore((s) => s.tasks);
  const activeTaskId = useAppStore((s) => s.activeTaskId);

  const activeTask = useMemo(
    () => tasks.find((t) => t.id === activeTaskId),
    [tasks, activeTaskId],
  );

  return { activeTaskId, activeTask };
}
