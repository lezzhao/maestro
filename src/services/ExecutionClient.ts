import { Channel, invoke } from "@tauri-apps/api/core";
import {
  decodeTransportEscapes,
  extractReadableTerminalChunk,
  normalizeTerminalChunk,
} from "../lib/utils/terminal";
import {
  CTRL_DONE,
  CTRL_ERROR,
  CTRL_EXIT,
  CTRL_RUN_ID,
  CTRL_VERIFICATION,
  CTRL_TOKEN_USAGE,
  isControlChunk,
  parseErrorChunk,
  parseExitCodeChunk,
  parseRunIdChunk,
  parseVerificationChunk,
  parseTokenUsageChunk,
} from "../lib/utils/controlChunks";
import type { VerificationSummary } from "../types";

export type ExecutionEvent =
  | { type: "runId"; runId: string }
  | { type: "text"; text: string }
  | { type: "verification"; verification: VerificationSummary }
  | { type: "tokenUsage"; usage: { approx_input_tokens: number; approx_output_tokens: number } }
  | { type: "done"; exitCode?: number | null }
  | { type: "error"; message: string };

export class ExecutionClient {
  private execId: string | null = null;
  private isStopped = false;

  constructor(
    private mode: "api" | "cli",
    private onEvent: (event: ExecutionEvent) => void
  ) {}

  public async start(request: Record<string, unknown>): Promise<{ exec_id: string; run_id?: string }> {
    this.isStopped = false;
    const onData = new Channel<string>();
    onData.onmessage = this.handleChunk.bind(this);

    const command = this.mode === "api" ? "chat_execute_api" : "chat_execute_cli";
    const result = await invoke<{ exec_id: string; run_id?: string }>(command, {
      request,
      onData,
    });

    this.execId = result.exec_id;
    return result;
  }

  public async stop(): Promise<void> {
    this.isStopped = true;
    if (this.execId !== null) {
      const command = this.mode === "api" ? "chat_execute_api_stop" : "chat_execute_cli_stop";
      try {
        await invoke(command, { request: { exec_id: this.execId } });
      } catch (e) {
        console.warn("ExecutionClient stop failed", e);
      }
    }
  }

  private handleChunk(chunk: string) {
    if (this.isStopped) return;

    if (isControlChunk(chunk)) {
      if (chunk.startsWith(CTRL_RUN_ID)) {
        const runId = parseRunIdChunk(chunk);
        if (runId) this.onEvent({ type: "runId", runId });
        return;
      }
      if (chunk.startsWith(CTRL_DONE)) {
        this.onEvent({ type: "done" });
        return;
      }
      if (chunk.startsWith(CTRL_EXIT)) {
        const exitCode = parseExitCodeChunk(chunk);
        if (exitCode === 0) {
          this.onEvent({ type: "done", exitCode });
        } else {
          this.onEvent({
            type: "error",
            message:
              exitCode === null
                ? "命令执行失败（未知退出码）"
                : `命令执行失败（退出码：${exitCode}）`,
          });
        }
        return;
      }
      if (chunk.startsWith(CTRL_ERROR)) {
        this.onEvent({ type: "error", message: parseErrorChunk(chunk) });
        return;
      }
      if (chunk.startsWith(CTRL_VERIFICATION)) {
        const verification = parseVerificationChunk<VerificationSummary>(chunk);
        if (verification) {
          this.onEvent({ type: "verification", verification });
        }
        return;
      }
      if (chunk.startsWith(CTRL_TOKEN_USAGE)) {
        const usage = parseTokenUsageChunk<{ approx_input_tokens: number; approx_output_tokens: number }>(chunk);
        if (usage) {
          this.onEvent({ type: "tokenUsage", usage });
        }
        return;
      }
    }

    if (this.mode === "api") {
      this.onEvent({ type: "text", text: chunk });
      return;
    }

    const decoded = decodeTransportEscapes(chunk);
    const normalized = normalizeTerminalChunk(decoded) || extractReadableTerminalChunk(decoded);
    if (!normalized) return;
    this.onEvent({ type: "text", text: normalized });
  }
}
