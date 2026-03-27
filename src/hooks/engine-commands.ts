import { invoke } from "@tauri-apps/api/core";
import type {
  EngineConfig,
  EngineModelListResult,
  EnginePreflightResult,
  EngineProfile,
} from "../types";

export function listEnginesCommand() {
  return invoke<Record<string, EngineConfig>>("engine_list");
}

export function preflightEngineCommand(engineId: string, profileId?: string | null) {
  return invoke<EnginePreflightResult>("engine_preflight", {
    engineId,
    profileId: profileId ?? null,
  });
}

export function switchTaskRuntimeBindingCommand(request: {
  taskId: string;
  engineId: string;
  profileId: string | null;
  sessionId: string | null;
}) {
  return invoke("task_switch_runtime_binding", { request });
}

export function switchEngineSessionCommand(engineId: string) {
  return invoke("engine_switch_session", {
    engineId,
    sessionId: null,
  });
}

export function upsertEngineCommand(engineId: string, engine: EngineConfig) {
  return invoke("engine_upsert", { id: engineId, engine });
}

export function deleteEngineCommand(engineId: string) {
  return invoke("engine_delete", { id: engineId });
}

export function setActiveProfileCommand(engineId: string, profileId: string) {
  return invoke("engine_set_active_profile", { engineId, profileId });
}

export function updateTaskProfileCommand(taskId: string, engineId: string, profileId: string) {
  return invoke("task_update_runtime_binding", {
    request: {
      taskId,
      engineId,
      profileId,
    },
  });
}

export function upsertProfileCommand(
  engineId: string,
  profileId: string,
  profile: EngineProfile,
) {
  return invoke("engine_upsert_profile", { engineId, profileId, profile });
}

export function listEngineModelsCommand(engineId: string) {
  return invoke<EngineModelListResult>("engine_list_models", { engineId });
}
