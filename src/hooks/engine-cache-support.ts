import { DEFAULT_PROFILE_ID } from "../constants";
import type {
  EngineConfig,
  EngineModelListResult,
  EngineModelListState,
  EnginePreflightResult,
} from "../types";

const PREFLIGHT_CACHE_TTL_MS = 30_000;
const PREFLIGHT_TIMEOUT_MS = 20_000;
const MODEL_LIST_CACHE_TTL_MS = 60_000;
const SHELL_COMMANDS = [
  "bash",
  "sh",
  "zsh",
  "fish",
  "powershell.exe",
  "powershell",
  "pwsh",
  "cmd.exe",
  "cmd",
];

type ResultCacheMap<T> = Map<string, { result: T; ts: number }>;

interface LoadEnginePreflightParams {
  engineId: string;
  profileId?: string | null;
  force?: boolean;
  preflightCache: ResultCacheMap<EnginePreflightResult>;
  preflightPending: Map<string, Promise<EnginePreflightResult>>;
  setEnginePreflight: (engineId: string, result: EnginePreflightResult) => void;
  fetchPreflight: (
    engineId: string,
    profileId?: string | null,
  ) => Promise<EnginePreflightResult>;
}

interface LoadEngineModelListParams {
  engineId: string;
  force?: boolean;
  modelListCache: ResultCacheMap<EngineModelListResult>;
  getActiveProfileId: (engineId: string) => string;
  fetchModels: (engineId: string) => Promise<EngineModelListResult>;
}

export function getEnginePreflightKey(engineId: string, profileId?: string | null) {
  return profileId && profileId.trim() ? `${engineId}::${profileId}` : engineId;
}

export function getEngineActiveProfileId(
  engines: Record<string, EngineConfig>,
  engineId: string,
) {
  const engine = engines[engineId];
  if (!engine?.profiles) return DEFAULT_PROFILE_ID;
  return (
    (engine.active_profile_id && engine.profiles[engine.active_profile_id]
      ? engine.active_profile_id
      : Object.keys(engine.profiles)[0]) || DEFAULT_PROFILE_ID
  );
}

export function clearEngineModelCache(
  modelListCache: ResultCacheMap<EngineModelListResult>,
  engineId: string,
) {
  for (const key of Array.from(modelListCache.keys())) {
    if (key.startsWith(`${engineId}::`)) {
      modelListCache.delete(key);
    }
  }
}

function setPreflightResult(
  setEnginePreflight: (engineId: string, result: EnginePreflightResult) => void,
  cacheKey: string,
  profileId: string | null | undefined,
  engineId: string,
  result: EnginePreflightResult,
) {
  setEnginePreflight(cacheKey, result);
  if (!profileId) {
    setEnginePreflight(engineId, result);
  }
}

function createPreflightErrorResult(
  engineId: string,
  profileId?: string | null,
  error?: unknown,
): EnginePreflightResult {
  return {
    engine_id: engineId,
    profile_id: profileId ?? undefined,
    command_exists: false,
    auth_ok: false,
    supports_headless: false,
    notes: String(error),
    cached: false,
    checked_at_ms: Date.now(),
  };
}

export async function loadEnginePreflight({
  engineId,
  profileId,
  force = false,
  preflightCache,
  preflightPending,
  setEnginePreflight,
  fetchPreflight,
}: LoadEnginePreflightParams): Promise<EnginePreflightResult> {
  const now = Date.now();
  const cacheKey = getEnginePreflightKey(engineId, profileId);
  const cached = preflightCache.get(cacheKey);

  if (!force && cached && now - cached.ts <= PREFLIGHT_CACHE_TTL_MS) {
    const result: EnginePreflightResult = {
      ...cached.result,
      cached: true,
      checked_at_ms: cached.ts,
    };
    setPreflightResult(setEnginePreflight, cacheKey, profileId, engineId, result);
    return result;
  }

  const pending = preflightPending.get(cacheKey);
  if (!force && pending) {
    return pending;
  }

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("Preflight timeout")), PREFLIGHT_TIMEOUT_MS);
  });

  const task = Promise.race([fetchPreflight(engineId, profileId), timeoutPromise])
    .then((result) => {
      const ts = Date.now();
      preflightCache.set(cacheKey, { result, ts });
      const liveResult: EnginePreflightResult = {
        ...result,
        cached: false,
        checked_at_ms: ts,
      };
      setPreflightResult(setEnginePreflight, cacheKey, profileId, engineId, liveResult);
      return liveResult;
    })
    .catch((error) => {
      const errorResult = createPreflightErrorResult(engineId, profileId, error);
      setPreflightResult(setEnginePreflight, cacheKey, profileId, engineId, errorResult);
      return errorResult;
    })
    .finally(() => {
      preflightPending.delete(cacheKey);
    });

  preflightPending.set(cacheKey, task);
  return task;
}

export async function loadEngineModelList({
  engineId,
  force = false,
  modelListCache,
  getActiveProfileId,
  fetchModels,
}: LoadEngineModelListParams): Promise<EngineModelListState> {
  const now = Date.now();
  const cacheKey = `${engineId}::${getActiveProfileId(engineId)}`;
  const cached = modelListCache.get(cacheKey);

  if (!force && cached && now - cached.ts <= MODEL_LIST_CACHE_TTL_MS) {
    return {
      ...cached.result,
      cached: true,
      fetched_at_ms: cached.ts,
    };
  }

  const result = await fetchModels(engineId);
  modelListCache.set(cacheKey, { result, ts: now });
  return {
    ...result,
    cached: false,
    fetched_at_ms: now,
  };
}

export function getAvailableEngines(
  engines: Record<string, EngineConfig>,
  enginePreflight: Record<string, EnginePreflightResult>,
  activeEngineId?: string,
) {
  return Object.values(engines).filter((engine) => {
    if (engine.id === activeEngineId) {
      return true;
    }

    const activeProfile = engine.profiles?.[engine.active_profile_id || DEFAULT_PROFILE_ID];
    const command = activeProfile?.command?.toLowerCase() || "";
    const isShell = SHELL_COMMANDS.some((shellCommand) => (
      command === shellCommand
      || command.endsWith(`/${shellCommand}`)
      || command.endsWith(`\\${shellCommand}`)
    ));

    if (isShell) {
      return false;
    }

    const preflight = enginePreflight?.[engine.id];
    return preflight?.command_exists !== false;
  });
}
