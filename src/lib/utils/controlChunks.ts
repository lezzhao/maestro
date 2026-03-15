/**
 * 流式控制块协议常量与解析函数
 * 与 Tauri chat.rs 中发送的控制块格式保持一致
 */

export const CTRL_PREFIX = "\u0000";

export const CTRL_RUN_ID = `${CTRL_PREFIX}RUN_ID:`;
export const CTRL_DONE = `${CTRL_PREFIX}DONE`;
export const CTRL_EXIT = `${CTRL_PREFIX}EXIT:`;
export const CTRL_ERROR = `${CTRL_PREFIX}ERROR:`;
export const CTRL_VERIFICATION = `${CTRL_PREFIX}VERIFICATION:`;

export function isControlChunk(chunk: string): boolean {
  return chunk.startsWith(CTRL_PREFIX);
}

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
