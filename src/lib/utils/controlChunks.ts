/**
 * 流式控制块协议解析与类型定义 (Fix 5)
 */

export const CTRL_PREFIX = "\u0000";

export type StreamFrame =
  | { type: "run_id"; payload: string }
  | { type: "output"; payload: string }
  | { type: "verification"; payload: import("../../types").VerificationSummary }
  | { type: "exit"; payload: number }
  | { type: "error"; payload: string }
  | { type: "done" }
  | { type: "token_usage"; payload: { approx_input_tokens: number; approx_output_tokens: number } }
  | { type: "tool_approval_request"; payload: { requestId: string; toolName: string; arguments: any } };

export function isControlChunk(chunk: string): boolean {
  return chunk.startsWith(CTRL_PREFIX);
}

/**
 * 解析流式控制帧。优先解析新的 JSON 格式，如果解析失败则回退到旧格式解析（用于过渡）。
 */
export function parseStreamFrame(chunk: string): StreamFrame | null {
  if (!isControlChunk(chunk)) return null;
  const raw = chunk.slice(CTRL_PREFIX.length);

  // 1. 尝试解析新版 JSON 协议
  try {
    const frame = JSON.parse(raw);
    if (frame && typeof frame === "object" && "type" in frame) {
      return frame as StreamFrame;
    }
  } catch {
    // 解析失败，回退到 legacy 模式
  }

  // 2. Legacy 解析逻辑 (兼容旧版后端)
  if (raw.startsWith("RUN_ID:")) return { type: "run_id", payload: raw.replace("RUN_ID:", "").trim() };
  if (raw.startsWith("DONE")) return { type: "done" };
  if (raw.startsWith("EXIT:")) return { type: "exit", payload: parseInt(raw.replace("EXIT:", "").trim(), 10) };
  if (raw.startsWith("ERROR:")) return { type: "error", payload: raw.replace("ERROR:", "").trim() };
  if (raw.startsWith("VERIFICATION:")) {
    try {
      return { type: "verification", payload: JSON.parse(raw.replace("VERIFICATION:", "").trim()) };
    } catch { return null; }
  }
  if (raw.startsWith("TOKEN_USAGE:")) {
    try {
      return { type: "token_usage", payload: JSON.parse(raw.replace("TOKEN_USAGE:", "").trim()) };
    } catch { return null; }
  }
  if (raw.startsWith("TOOL_APPROVAL_REQUEST:")) {
    try {
      return { type: "tool_approval_request", payload: JSON.parse(raw.replace("TOOL_APPROVAL_REQUEST:", "").trim()) };
    } catch { return null; }
  }

  return null;
}

// Keep legacy constants for compatibility during refactor
export const CTRL_RUN_ID = `${CTRL_PREFIX}RUN_ID:`;
export const CTRL_DONE = `${CTRL_PREFIX}DONE`;
export const CTRL_EXIT = `${CTRL_PREFIX}EXIT:`;
export const CTRL_ERROR = `${CTRL_PREFIX}ERROR:`;
export const CTRL_VERIFICATION = `${CTRL_PREFIX}VERIFICATION:`;
export const CTRL_TOKEN_USAGE = `${CTRL_PREFIX}TOKEN_USAGE:`;
export const CTRL_TOOL_APPROVAL_REQUEST = `${CTRL_PREFIX}TOOL_APPROVAL_REQUEST:`;

export function parseRunIdChunk(chunk: string): string | null {
  const raw = chunk.replace(CTRL_RUN_ID, "").trim();
  return raw || null;
}

export function parseExitCodeChunk(chunk: string): number | null {
  const raw = chunk.replace(CTRL_EXIT, "").trim();
  const code = Number(raw);
  return Number.isFinite(code) ? code : null;
}

export function parseErrorChunk(chunk: string): string {
  return chunk.replace(CTRL_ERROR, "").trim() || "unknown error";
}

export function parseVerificationChunk<T>(chunk: string): T | null {
  const raw = chunk.replace(CTRL_VERIFICATION, "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function parseTokenUsageChunk<T>(chunk: string): T | null {
  const raw = chunk.replace(CTRL_TOKEN_USAGE, "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function parseToolApprovalRequestChunk<T>(chunk: string): T | null {
  const raw = chunk.replace(CTRL_TOOL_APPROVAL_REQUEST, "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
