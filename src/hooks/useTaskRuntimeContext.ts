/**
 * useTaskRuntimeContext: read-only consumer of authoritative resolved context.
 * Does NOT infer execution mode or readiness; backend is source of truth.
 * Fallback only for startup window: conservative display (executionMode: cli, isReady: false).
 */
import { useMemo } from "react";
import { useRuntimeStoreState } from "./use-app-store-selectors";
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

  if (!engines) return defaultEmpty;

  // 1. Authoritative Backend Resolution (If Available)
  if (activeTask && activeTask.resolvedRuntimeContext) {
    const resolved = activeTask.resolvedRuntimeContext;
    const engineId = resolved.engineId;
    const engine = engines[engineId] || null;
    const profileId = resolved.profileId || null;
    const profile = profileId && engine ? (engine.profiles as any)?.[profileId] || null : null;

    const executionMode = resolved.executionMode;
    const isHeadless = resolved.supportsHeadless;

    const activePreflightKey = profileId ? `${engineId}::${profileId}` : engineId;
    const activePreflight = enginePreflight[activePreflightKey] || enginePreflight[engineId];
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

  // 2. Fallback: No task or no resolved context available (Startup window or idle)
  const engineId = activeTask?.engineId || Object.keys(engines)[0] || "";
  const engine = engines[engineId] || null;
  if (!engine || !engine.profiles) {
    return { ...defaultEmpty, engineId, engine };
  }
  let profileId = activeTask?.profileId;
  const profiles = engine.profiles as Record<string, EngineProfile>;
  if (!profileId || !profiles[profileId]) {
    profileId =
      engine.active_profile_id && profiles[engine.active_profile_id]
        ? engine.active_profile_id
        : Object.keys(profiles)[0] || null;
  }
  const profile = profileId ? profiles[profileId] || null : null;
  const executionMode = profile?.execution_mode || "cli";
  const activePreflightKey = profileId ? `${engineId}::${profileId}` : engineId;
  const activePreflight = enginePreflight[activePreflightKey] || enginePreflight[engineId];

  const isCliReady = Boolean(activePreflight?.command_exists) && Boolean(activePreflight?.auth_ok);
  const isApiReady = Boolean(profile?.api_key && profile?.api_base_url && profile?.model);
  const isReady = executionMode === "api" ? isApiReady : isCliReady;

  return {
    engineId,
    engine,
    profileId,
    profile,
    executionMode,
    isReady,
    isHeadless: false,
  };
}

/**
 * Get runtime context for the active task (no args) or a specific task (taskId).
 * Prefer this over directly consuming AppTask.
 */
export function useTaskRuntimeContext(taskId?: string | null): TaskRuntimeContext {
  const { activeTask } = useActiveTask();
  const { tasks, engines, enginePreflight } = useRuntimeStoreState();

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
