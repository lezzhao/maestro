import { invoke } from "@tauri-apps/api/core";

export function reconcileActiveCliSessionsCommand() {
  return invoke("cli_reconcile_active_sessions");
}

export function cleanupDeadPtySessionsCommand() {
  return invoke("pty_cleanup_dead_sessions");
}

export function updateMaxConcurrentTasksCommand(count: number) {
  return invoke("update_max_concurrent_tasks", { count });
}
