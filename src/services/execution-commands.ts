import { Channel, invoke } from "@tauri-apps/api/core";

export function startExecutionCommand(
  mode: "api" | "cli",
  request: Record<string, unknown>,
  onChunk: (chunk: string) => void,
) {
  const onData = new Channel<string>();
  onData.onmessage = (chunk) => onChunk(chunk);
  const command = mode === "api" ? "chat_execute_api" : "chat_execute_cli";
  return invoke<{ exec_id: string; run_id?: string }>(command, {
    request,
    onData,
  });
}

export function stopExecutionCommand(mode: "api" | "cli", execId: string) {
  const command = mode === "api" ? "chat_execute_api_stop" : "chat_execute_cli_stop";
  return invoke(command, { request: { exec_id: execId } });
}
