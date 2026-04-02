import { invoke } from "@tauri-apps/api/core";

export function reconcileActiveCliSessionsCommand() {
  return invoke("cli_reconcile_active_sessions");
}

export function cleanupDeadPtySessionsCommand() {
  return invoke("pty_cleanup_dead_sessions");
}
