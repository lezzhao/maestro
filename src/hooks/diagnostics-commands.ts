import { invoke } from "@tauri-apps/api/core";
import type { CliPruneResult, CliSessionListItem } from "../types";

export function listCliSessionsCommand(engineId?: string) {
  return invoke<CliSessionListItem[]>("cli_list_sessions", {
    engineId: engineId || null,
  });
}

export function readCliSessionLogsCommand(engineId: string, sessionId: string, limit = 120) {
  return invoke<string>("cli_read_session_logs", {
    engineId,
    sessionId,
    limit,
  });
}

export function pruneCliSessionsCommand(engineId?: string) {
  return invoke<CliPruneResult>("cli_prune_sessions", {
    engineId: engineId || null,
    status: "stopped",
    olderThanHours: 0,
  });
}
