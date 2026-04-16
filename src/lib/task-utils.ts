import { DEFAULT_ENGINE_ID, DEFAULT_PROFILE_ID } from "../constants";
import type { EngineState } from "../types";

/**
 * Resolves the default engine and profile to use for a new task.
 */
export function resolveDefaultRuntime(engines: Record<string, EngineState>) {
  const engineIds = Object.keys(engines).sort();
  if (engineIds.length === 0) {
    throw new Error("No AI Engines configured. Please go to Settings and add a provider.");
  }

  const defaultEngineId = engineIds[0] || DEFAULT_ENGINE_ID;
  const engine = engines[defaultEngineId];
  
  const defaultProfileId =
    engine?.active_profile_id && engine?.profiles?.[engine.active_profile_id]
      ? engine.active_profile_id
      : engine?.profiles
        ? Object.keys(engine.profiles)[0]
        : DEFAULT_PROFILE_ID;

  return {
    engineId: defaultEngineId,
    profileId: defaultProfileId,
  };
}
