import { useCallback, useEffect, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { DEFAULT_PROFILE_ID } from "../constants";
import { useAppStore } from "../stores/appStore";
import { useActiveTask } from "./useActiveTask";
import type {
  EngineConfig,
  EngineModelListResult,
  EngineModelListState,
  EnginePreflightResult,
  EngineProfile,
} from "../types";

export function useEngine() {
  const engines = useAppStore((s) => s.engines);
  const setEngines = useAppStore((s) => s.setEngines);
  const enginePreflight = useAppStore((s) => s.enginePreflight);
  const setEnginePreflight = useAppStore((s) => s.setEnginePreflight);
  
  const { activeTask, activeTaskId } = useActiveTask();
  const sessionId = activeTask?.sessionId;

  const preflightCacheRef = useRef<
    Map<string, { result: EnginePreflightResult; ts: number }>
  >(new Map());
  const preflightPendingRef = useRef<Map<string, Promise<EnginePreflightResult>>>(
    new Map(),
  );
  const modelListCacheRef = useRef<Map<string, { result: EngineModelListResult; ts: number }>>(
    new Map(),
  );

  const getActiveProfileId = useCallback(
    (engineId: string) => {
      const engine = engines[engineId];
      if (!engine?.profiles) return DEFAULT_PROFILE_ID;
      return (
        (engine.active_profile_id && engine.profiles[engine.active_profile_id]
          ? engine.active_profile_id
          : Object.keys(engine.profiles)[0]) || DEFAULT_PROFILE_ID
      );
    },
    [engines],
  );

  const clearModelCacheForEngine = useCallback((engineId: string) => {
    for (const key of Array.from(modelListCacheRef.current.keys())) {
      if (key.startsWith(`${engineId}::`)) {
        modelListCacheRef.current.delete(key);
      }
    }
  }, []);

  const refreshEngines = useCallback(async () => {
    console.log("[useEngine] Refreshing engines...");
    try {
      const next = await invoke<Record<string, EngineConfig>>("engine_list");
      console.log("[useEngine] Engines from backend:", Object.keys(next));
      setEngines(next);
    } catch (e) {
      console.error("[useEngine] Failed to list engines:", e);
    }
  }, [setEngines]);

  const preflightEngine = useCallback(
    async (engineId: string, options?: { force?: boolean }) => {
      const force = options?.force ?? false;
      const now = Date.now();
      const cache = preflightCacheRef.current.get(engineId);
      const cacheTtlMs = 30_000;

      if (!force && cache && now - cache.ts <= cacheTtlMs) {
        const cachedResult: EnginePreflightResult = {
          ...cache.result,
          cached: true,
          checked_at_ms: cache.ts,
        };
        setEnginePreflight(engineId, cachedResult);
        return cachedResult;
      }

      const pending = preflightPendingRef.current.get(engineId);
      if (!force && pending) {
        return pending;
      }

      const timeoutMs = 20_000; // 20s timeout
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Preflight timeout")), timeoutMs)
      );

      const task = Promise.race([
        invoke<EnginePreflightResult>("engine_preflight", { engineId }),
        timeoutPromise
      ])
        .then((result) => {
          const ts = Date.now();
          preflightCacheRef.current.set(engineId, { result, ts });
          const liveResult: EnginePreflightResult = {
            ...result,
            cached: false,
            checked_at_ms: ts,
          };
          setEnginePreflight(engineId, liveResult);
          return liveResult;
        })
        .catch((err) => {
          const errorResult: EnginePreflightResult = {
            engine_id: engineId,
            command_exists: false,
            auth_ok: false,
            supports_headless: false,
            notes: String(err),
            cached: false,
            checked_at_ms: Date.now(),
          };
          setEnginePreflight(engineId, errorResult);
          return errorResult;
        })
        .finally(() => {
          preflightPendingRef.current.delete(engineId);
        });
      preflightPendingRef.current.set(engineId, task);
      return task;
    },
    [setEnginePreflight],
  );

  const switchEngine = useCallback(
    async (engineId: string) => {
      if (activeTaskId) {
        // Preserve task's profileId when target engine has the same profile; otherwise let backend fallback to engine.active_profile_id
        const targetEngine = engines[engineId];
        const profileId =
          activeTask?.profileId &&
          targetEngine?.profiles &&
          targetEngine.profiles[activeTask.profileId]
            ? activeTask.profileId
            : null;
        await invoke("task_switch_runtime_binding", {
          request: {
            taskId: activeTaskId,
            engineId,
            profileId,
            sessionId: sessionId ?? null,
          },
        });
      } else {
        await invoke("engine_switch_session", {
          engineId,
          sessionId: null,
        });
      }
      void preflightEngine(engineId, { force: true });
    },
    [activeTask, activeTaskId, engines, preflightEngine, sessionId],
  );

  const upsertEngine = useCallback(
    async (engine_id: string, engine: EngineConfig) => {
      await invoke("engine_upsert", { id: engine_id, engine });
      await refreshEngines();
      await preflightEngine(engine_id, { force: true });
    },
    [preflightEngine, refreshEngines],
  );

  const deleteEngine = useCallback(
    async (engineId: string) => {
      console.log(`[useEngine] Deleting engine: ${engineId}`);
      try {
        await invoke("engine_delete", { id: engineId });
        console.log(`[useEngine] Deletion successful for: ${engineId}`);
        await refreshEngines();
        toast.success(`提供商 ${engineId} 已成功删除`);
      } catch (e) {
        console.error("[useEngine] Failed to delete engine:", e);
        toast.error(`删除失败: ${String(e)}`);
        throw e;
      }
    },
    [refreshEngines],
  );

  const preflightAll = useCallback(async () => {
    const ids = Object.keys(engines);
    if (ids.length === 0) return;
    await Promise.allSettled(ids.map((id) => preflightEngine(id)));
  }, [engines, preflightEngine]);

  /** Updates engine's default profile. Does NOT change current task's profile. Use updateTaskProfile for that. */
  const setActiveProfile = useCallback(
    async (engineId: string, profileId: string) => {
      await invoke("engine_set_active_profile", { engineId, profileId });
      clearModelCacheForEngine(engineId);
      await refreshEngines();
      await preflightEngine(engineId, { force: true });
    },
    [clearModelCacheForEngine, preflightEngine, refreshEngines],
  );

  /** Updates current task's profile binding. Use when switching profile for the active task. */
  const updateTaskProfile = useCallback(
    async (taskId: string, engineId: string, profileId: string) => {
      await invoke("task_update_runtime_binding", {
        request: {
          taskId,
          engineId,
          profileId,
        },
      });
      clearModelCacheForEngine(engineId);
      await refreshEngines();
      await preflightEngine(engineId, { force: true });
    },
    [clearModelCacheForEngine, preflightEngine, refreshEngines],
  );

  const upsertProfile = useCallback(
    async (engineId: string, profileId: string, profile: EngineProfile) => {
      await invoke("engine_upsert_profile", { engineId, profileId, profile });
      clearModelCacheForEngine(engineId);
      await refreshEngines();
      await preflightEngine(engineId, { force: true });
    },
    [clearModelCacheForEngine, preflightEngine, refreshEngines],
  );

  const listModels = useCallback(
    async (engineId: string, options?: { force?: boolean }) => {
      const force = options?.force ?? false;
      const now = Date.now();
      const cacheKey = `${engineId}::${getActiveProfileId(engineId)}`;
      const cache = modelListCacheRef.current.get(cacheKey);
      const cacheTtlMs = 60_000;
      if (!force && cache && now - cache.ts <= cacheTtlMs) {
        const cachedResult: EngineModelListState = {
          ...cache.result,
          cached: true,
          fetched_at_ms: cache.ts,
        };
        return cachedResult;
      }
      const result = await invoke<EngineModelListResult>("engine_list_models", { engineId });
      modelListCacheRef.current.set(cacheKey, { result, ts: now });
      const liveResult: EngineModelListState = {
        ...result,
        cached: false,
        fetched_at_ms: now,
      };
      return liveResult;
    },
    [getActiveProfileId],
  );

  const updateProfileModel = useCallback(
    async (engineId: string, profileId: string, model: string) => {
      const engine = engines[engineId];
      if (!engine?.profiles) return;
      const profile = engine.profiles[profileId];
      if (!profile) return;
      await upsertProfile(engineId, profileId, {
        ...profile,
        model,
      });
    },
    [engines, upsertProfile],
  );

  const enginesInitializedRef = useRef(false);
  useEffect(() => {
    void refreshEngines();
  }, [refreshEngines]);

  useEffect(() => {
    if (!enginesInitializedRef.current && Object.keys(engines).length > 0) {
      enginesInitializedRef.current = true;
      void preflightAll();
    }
  }, [engines, preflightAll]);

  const availableEngines = useMemo(() => {
    const SHELL_COMMANDS = ["bash", "sh", "zsh", "fish", "powershell.exe", "powershell", "pwsh", "cmd.exe", "cmd"];
    
    return Object.values(engines).filter((e) => {
      // Always show active engine
      if (e.id === activeTask?.engineId) return true;
      
      const activeProfile = e.profiles?.[e.active_profile_id || "default"];
      const command = activeProfile?.command?.toLowerCase() || "";
      
      // Filter out shells (ends with bash, sh, etc.)
      const isShell = SHELL_COMMANDS.some(sc => 
        command === sc || command.endsWith(`/${sc}`) || command.endsWith(`\\${sc}`)
      );
      
      if (isShell) {
        return false;
      }

      // Filter out engines where command explicitly doesn't exist
      const res = enginePreflight?.[e.id];
      return res?.command_exists !== false;
    });
  }, [engines, enginePreflight, activeTask?.engineId]);

  return {
    engines,
    availableEngines,
    enginePreflight,
    refreshEngines,
    preflightEngine,
    preflightAll,
    switchEngine,
    upsertEngine,
    deleteEngine,
    setActiveProfile,
    updateTaskProfile,
    upsertProfile,
    listModels,
    updateProfileModel,
  };
}
