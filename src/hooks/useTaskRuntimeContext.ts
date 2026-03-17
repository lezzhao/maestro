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

/** Pure resolution logic for testing. When task.profileId differs from engine.active_profile_id, task.profileId wins if valid. */
export function resolveTaskRuntimeContextFromState(
  activeTask: AppTask | null,
  engines: Record<string, EngineConfig> | null,
  enginePreflight: Record<string, EnginePreflightResult>,
): TaskRuntimeContext {
  if (!activeTask || !engines) {
    return {
      engineId: "",
      engine: null,
      profileId: null,
      profile: null,
      executionMode: "cli",
      isReady: false,
      isHeadless: false,
    };
  }

  const engineId = activeTask.engineId || Object.keys(engines)[0] || "";
  const engine = engines[engineId] || null;

  if (!engine || !engine.profiles) {
    return {
      engineId,
      engine,
      profileId: null,
      profile: null,
      executionMode: "cli",
      isReady: false,
      isHeadless: false,
    };
  }

  // 1. Authoritative source: task.profileId
  // 2. Fallback: engine.active_profile_id (for legacy tasks created before profileId support)
  // 3. Fallback: first available profile
  let profileId = activeTask.profileId;

  // If task has no profileId or its profileId is no longer valid in the engine
  if (!profileId || !engine.profiles[profileId]) {
    profileId =
      engine.active_profile_id && engine.profiles[engine.active_profile_id]
        ? engine.active_profile_id
        : Object.keys(engine.profiles)[0] || null;
  }

  const profile = profileId ? engine.profiles[profileId] || null : null;
  const executionMode = (profile?.execution_mode || "cli") as "api" | "cli";
  const isHeadless = Boolean(profile?.supports_headless ?? engine.supports_headless);

  const activePreflight = enginePreflight[engineId];
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
    isHeadless,
  };
}

export function useTaskRuntimeContext(): TaskRuntimeContext {
  const { activeTask } = useActiveTask();
  const engines = useAppStore((s) => s.engines);
  const enginePreflight = useAppStore((s) => s.enginePreflight);

  return useMemo(
    () =>
      resolveTaskRuntimeContextFromState(
        activeTask ?? null,
        engines,
        enginePreflight ?? {},
      ),
    [activeTask, engines, enginePreflight],
  );
}
