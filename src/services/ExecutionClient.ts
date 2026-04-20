import {
  decodeTransportEscapes,
  extractReadableTerminalChunk,
  normalizeTerminalChunk,
} from "../lib/utils/terminal";
import {
  startExecutionCommand,
  stopExecutionCommand,
} from "./execution-commands";
import {
  isControlChunk,
  parseStreamFrame,
  type StreamFrame,
} from "../lib/utils/controlChunks";
import type { VerificationSummary } from "../types";

export type ExecutionEvent =
  | { type: "runId"; runId: string; cycleId: string }
  | { type: "text"; text: string; cycleId: string }
  | { type: "verification"; verification: VerificationSummary; cycleId: string }
  | { type: "tokenUsage"; usage: { approx_input_tokens: number; approx_output_tokens: number }; cycleId: string }
  | { type: "done"; exitCode?: number | null; cycleId: string }
  | { type: "toolApprovalRequest"; request: { requestId: string; toolName: string; arguments: string }; cycleId: string }
  | { type: "reasoning"; content: string; cycleId: string }
  | { type: "error"; message: string; cycleId: string };

export class ExecutionClient {
  private execId: string | null = null;
  private currentRunId: string | null = null;
  private isStopped = false;

  constructor(
    private taskId: string,
    private cycleId: string,
    private mode: "api" | "cli",
    private onEvent: (event: ExecutionEvent) => void
  ) {}

  public async start(request: Record<string, unknown>): Promise<{ exec_id: string; run_id?: string }> {
    this.isStopped = false;
    const result = await startExecutionCommand(this.mode, request, this.handleChunk.bind(this));

    this.execId = result.exec_id;
    return result;
  }

  public async stop(): Promise<void> {
    this.isStopped = true;
    if (this.execId !== null) {
      try {
        await stopExecutionCommand(this.mode, this.execId);
      } catch (e) {
        console.warn("ExecutionClient stop failed", e);
      }
    }
  }

  private handleChunk(chunk: string) {
    if (this.isStopped) {
      return;
    }

    if (isControlChunk(chunk)) {
      const frame: StreamFrame | null = parseStreamFrame(chunk);
      if (!frame) return;

      // Internal state tracking for the current run
      if (frame.type === "run_id") {
        this.currentRunId = frame.payload;
        console.debug(`[ExecutionClient] Starting run: ${this.currentRunId} for task: ${this.taskId} cycle: ${this.cycleId}`);
      }

      switch (frame.type) {
        case "run_id":
          this.onEvent({ type: "runId", runId: frame.payload, cycleId: this.cycleId });
          break;
        case "done":
          this.onEvent({ type: "done", cycleId: this.cycleId });
          break;
        case "exit": {
          const exitCode = frame.payload;
          if (exitCode === 0) {
            this.onEvent({ type: "done", exitCode, cycleId: this.cycleId });
          } else {
            this.onEvent({
              type: "error",
              message: `命令执行失败（退出码：${exitCode}）`,
              cycleId: this.cycleId,
            });
          }
          break;
        }
        case "error":
          this.onEvent({ type: "error", message: frame.payload, cycleId: this.cycleId });
          break;
        case "verification":
          this.onEvent({ type: "verification", verification: frame.payload, cycleId: this.cycleId });
          break;
        case "token_usage":
          this.onEvent({ type: "tokenUsage", usage: frame.payload, cycleId: this.cycleId });
          break;
        case "tool_approval_request":
          this.onEvent({ type: "toolApprovalRequest", request: frame.payload, cycleId: this.cycleId });
          break;
        case "reasoning":
          this.onEvent({ type: "reasoning", content: frame.payload, cycleId: this.cycleId });
          break;
      }
      return;
    }

    if (this.mode === "api") {
      this.onEvent({ type: "text", text: chunk, cycleId: this.cycleId });
      return;
    }

    // CLI mode terminal handling
    const decoded = decodeTransportEscapes(chunk);
    const normalized = normalizeTerminalChunk(decoded) || extractReadableTerminalChunk(decoded);
    if (!normalized) return;
    this.onEvent({ type: "text", text: normalized, cycleId: this.cycleId });
  }
}
