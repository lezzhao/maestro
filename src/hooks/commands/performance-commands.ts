import { invoke } from "@tauri-apps/api/core";

export function startProcessMonitorCommand(sessionId: string, intervalMs = 2500) {
  return invoke("process_start_monitor", { sessionId, intervalMs });
}

export function stopProcessMonitorCommand() {
  return invoke("process_stop_monitor");
}
