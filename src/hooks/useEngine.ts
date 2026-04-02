import { useCallback, useEffect, useRef, useMemo } from "react";
import { toast } from "sonner";
import { useEngineStoreState } from "./use-app-store-selectors";
import { useActiveTask } from "./useActiveTask";
import {
  deleteEngineCommand,
  listEngineModelsCommand,
  listEnginesCommand,
  preflightEngineCommand,
  setActiveProfileCommand,
  switchEngineSessionCommand,
  switchTaskRuntimeBindingCommand,
  updateTaskProfileCommand,
  upsertEngineCommand,
  upsertProfileCommand,
  verifyLLMConnectionCommand,
} from "./commands/engine-commands";
import {
  clearEngineModelCache,
  getAvailableEngines,
  getEngineActiveProfileId,
  getEnginePreflightKey,
  loadEngineModelList,
  loadEnginePreflight,
} from "./engine-cache-support";
import {
  AuthScheme,
  EngineConfig,
  EngineModelListResult,
  EnginePreflightResult,
  EngineProfile,
} from "../types";

export function useEngine() {
  const { engines, setEngines, enginePreflight, setEnginePreflight } = useEngineStoreState();
  
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

  const getPreflightKey = useCallback(
    (engineId: string, profileId?: string | null) =>
      getEnginePreflightKey(engineId, profileId),
    [],
  );

  const getActiveProfileId = useCallback(
    (engineId: string) => getEngineActiveProfileId(engines, engineId),
    [engines],
  );

  const clearModelCacheForEngine = useCallback((engineId: string) => {
    clearEngineModelCache(modelListCacheRef.current, engineId);
  }, []);

  const refreshEngines = useCallback(async () => {
    console.log("[useEngine] Refreshing engines...");
    try {
      const next = await listEnginesCommand();
      console.log("[useEngine] Engines from backend:", Object.keys(next));
      setEngines(next);
    } catch (e) {
      console.error("[useEngine] Failed to list engines:", e);
    }
  }, [setEngines]);

  const preflightEngine = useCallback(
    async (engineId: string, profileId?: string | null, options?: { force?: boolean }) => {
      return loadEnginePreflight({
        engineId,
        profileId,
        force: options?.force ?? false,
        preflightCache: preflightCacheRef.current,
        preflightPending: preflightPendingRef.current,
        setEnginePreflight,
        fetchPreflight: preflightEngineCommand,
      });
    },
    [setEnginePreflight],
  );

  const switchEngine = useCallback(
    async (engineId: string) => {
      let targetProfileId: string | null = null;
      if (activeTaskId) {
        // Preserve task's profileId when target engine has the same profile; otherwise let backend fallback to engine.active_profile_id
        const targetEngine = engines[engineId];
        targetProfileId =
          activeTask?.profileId &&
          targetEngine?.profiles &&
          targetEngine.profiles[activeTask.profileId]
            ? activeTask.profileId
            : null;
        await switchTaskRuntimeBindingCommand({
          taskId: activeTaskId,
          engineId,
          profileId: targetProfileId,
          sessionId: sessionId ?? null,
        });
      } else {
        await switchEngineSessionCommand(engineId);
      }
      void preflightEngine(engineId, targetProfileId, { force: true });
    },
    [activeTask, activeTaskId, engines, preflightEngine, sessionId],
  );

  const upsertEngine = useCallback(
    async (engine_id: string, engine: EngineConfig) => {
      await upsertEngineCommand(engine_id, engine);
      await refreshEngines();
      await preflightEngine(engine_id, null, { force: true });
    },
    [preflightEngine, refreshEngines],
  );

  const deleteEngine = useCallback(
    async (engineId: string) => {
      console.log(`[useEngine] Deleting engine: ${engineId}`);
      try {
        await deleteEngineCommand(engineId);
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
    await Promise.allSettled(ids.map((id) => preflightEngine(id, null)));
  }, [engines, preflightEngine]);

  /** Updates engine's default profile. Does NOT change current task's profile. Use updateTaskProfile for that. */
  const setActiveProfile = useCallback(
    async (engineId: string, profileId: string) => {
      await setActiveProfileCommand(engineId, profileId);
      clearModelCacheForEngine(engineId);
      await refreshEngines();
      await preflightEngine(engineId, null, { force: true });
    },
    [clearModelCacheForEngine, preflightEngine, refreshEngines],
  );

  /** Updates current task's profile binding. Use when switching profile for the active task. */
  const updateTaskProfile = useCallback(
    async (taskId: string, engineId: string, profileId: string) => {
      await updateTaskProfileCommand(taskId, engineId, profileId);
      clearModelCacheForEngine(engineId);
      await refreshEngines();
      await preflightEngine(engineId, profileId, { force: true });
    },
    [clearModelCacheForEngine, preflightEngine, refreshEngines],
  );

  const upsertProfile = useCallback(
    async (engineId: string, profileId: string, profile: EngineProfile) => {
      await upsertProfileCommand(engineId, profileId, profile);
      clearModelCacheForEngine(engineId);
      await refreshEngines();
      await preflightEngine(engineId, null, { force: true });
    },
    [clearModelCacheForEngine, preflightEngine, refreshEngines],
  );

  const listModels = useCallback(
    async (engineId: string, options?: { force?: boolean }) => {
      return loadEngineModelList({
        engineId,
        force: options?.force ?? false,
        modelListCache: modelListCacheRef.current,
        getActiveProfileId,
        fetchModels: listEngineModelsCommand,
      });
    },
    [getActiveProfileId],
  );

  const verifyConnection = useCallback(
    async (providerId: string, auth: AuthScheme, baseUrl?: string | null) => {
      return verifyLLMConnectionCommand(providerId, auth, baseUrl);
    },
    [],
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

  useEffect(() => {
    if (!activeTask?.engineId) return;
    const preflightKey = getPreflightKey(activeTask.engineId, activeTask.profileId);
    if (enginePreflight[preflightKey]) return;
    void preflightEngine(activeTask.engineId, activeTask.profileId);
  }, [
    activeTask?.engineId,
    activeTask?.profileId,
    enginePreflight,
    getPreflightKey,
    preflightEngine,
  ]);

  const availableEngines = useMemo(() => {
    return getAvailableEngines(engines, enginePreflight, activeTask?.engineId);
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
    onVerifyConnection: verifyConnection,
  };
}
