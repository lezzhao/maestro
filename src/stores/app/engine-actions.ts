import type { EngineConfig, EnginePreflightResult } from "../../types";
import type { SetFn, GetFn } from "./types";

export function createEngineActions(set: SetFn, _get: GetFn) {
  return {
    setEngines: (engines: Record<string, EngineConfig>) => set({ engines }),
    setEnginePreflight: (engineId: string, result: EnginePreflightResult) =>
      set((state) => ({
        enginePreflight: { ...state.enginePreflight, [engineId]: result },
      })),
    setSpecProvider: (specProvider: "none" | "maestro" | "custom") => set({ specProvider }),
  };
}
