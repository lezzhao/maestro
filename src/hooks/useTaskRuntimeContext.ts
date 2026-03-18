/**
 * useTaskRuntimeContext: read-only consumer of authoritative resolved context.
 * Does NOT infer execution mode or readiness; backend is source of truth.
 * Fallback only for startup window: conservative display (executionMode: cli, isReady: false).
 */
import { useMemo } from "react";
import { useAppStore } from "../stores/appStore";
import { useActiveTask } from "./useActiveTask";
import type { AppTask, EngineConfig, EnginePreflightResult, EngineProfile } from "../types";

export interface TaskRuntimeContext {
  engineId: string;
  engine: EngineConfig | null;
  profileId: string | null;
  profile: EngineProfile | null;
  executionMode: "api" | "cli";
  isReady: boolean;
  isHeadless: boolean;
}

export function resolveTaskRuntimeContextFromState(
  activeTask: AppTask | null,
  engines: Record<string, EngineConfig> | null,
  enginePreflight: Record<string, EnginePreflightResult>,
): TaskRuntimeContext {
  const defaultEmpty = {
    engineId: "",
    engine: null,
    profileId: null,
    profile: null,
    executionMode: "cli" as const,
    isReady: false,
    isHeadless: false,
  };

  if (!activeTask || !engines) return defaultEmpty;

  const resolved = activeTask.resolvedRuntimeContext;

  // 1. Authoritative Backend Resolution (If Available)
  if (resolved) {
    const engineId = resolved.engineId;
    const engine = engines[engineId] || null;
    const profileId = resolved.profileId || null;
    const profile = profileId && engine ? engine.profiles?.[profileId] || null : null;

    const executionMode = resolved.executionMode;
    const isHeadless = resolved.supportsHeadless;

    const activePreflight = enginePreflight[engineId];
    const isCliReady = Boolean(activePreflight?.command_exists) && Boolean(activePreflight?.auth_ok);
    const isApiReady = Boolean(resolved.apiProvider && resolved.apiBaseUrl && resolved.model);
    const isReady = executionMode === "api" ? isApiReady : isCliReady;

    return {
      engineId,
      engine,
      profileId,
      profile,
      executionMode,
      isReady,
      isHeadless,
    };
  }

  // 2. Startup-window fallback: backend context not yet available.
  // Conservative only: executionMode=cli, isReady=false, isHeadless=false.
  // Do NOT infer execution mode or readiness; backend is authoritative.
  const engineId = activeTask.engineId || Object.keys(engines)[0] || "";
  const engine = engines[engineId] || null;
  if (!engine || !engine.profiles) {
    return { ...defaultEmpty, engineId, engine };
  }
  let profileId = activeTask.profileId;
  if (!profileId || !engine.profiles[profileId]) {
    profileId =
      engine.active_profile_id && engine.profiles[engine.active_profile_id]
        ? engine.active_profile_id
        : Object.keys(engine.profiles)[0] || null;
  }
  const profile = profileId ? engine.profiles[profileId] || null : null;
  return {
    engineId,
    engine,
    profileId,
    profile,
    executionMode: "cli" as const,
    isReady: false,
    isHeadless: false,
  };
}

/**
 * Get runtime context for the active task (no args) or a specific task (taskId).
 * Prefer this over directly consuming AppTask.
 */
export function useTaskRuntimeContext(taskId?: string | null): TaskRuntimeContext {
  const { activeTask } = useActiveTask();
  const tasks = useAppStore((s) => s.tasks);
  const engines = useAppStore((s) => s.engines);
  const enginePreflight = useAppStore((s) => s.enginePreflight);

  const targetTask = useMemo(() => {
    if (taskId != null && taskId !== "") {
      return tasks.find((t) => t.id === taskId) ?? null;
    }
    return activeTask ?? null;
  }, [taskId, tasks, activeTask]);

  return useMemo(
    () =>
      resolveTaskRuntimeContextFromState(
        targetTask,
        engines,
        enginePreflight ?? {},
      ),
    [targetTask, engines, enginePreflight],
  );
}
