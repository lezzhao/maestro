export const ANSI_RE = /\x1B\[[0-9;]*[a-zA-Z]/g;
export const OSC_RE = /\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g;
export const OTHER_ESC_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
export const C0_CTRL_RE = /[\x00-\x08\x0B-\x1F\x7F]/g;

export function stripAnsi(input: string): string {
  return input.replace(ANSI_RE, "");
}

export function decodeTransportEscapes(input: string): string {
  let out = input;
  if (out.startsWith("\"") && out.endsWith("\"")) {
    try {
      const parsed = JSON.parse(out);
      if (typeof parsed === "string") {
        out = parsed;
      }
    } catch {
      // Keep raw string when payload is not valid JSON-quoted text.
    }
  }
  out = out.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
  out = out
    .replace(/\\r/g, "\r")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
    
  // If it's still wrapped in quotes (backend sent as quoted string), strip them
  if (out.length >= 2 && out.startsWith('"') && out.endsWith('"')) {
    out = out.substring(1, out.length - 1);
  }
  return out;
}

export function squashCarriageReturns(input: string): string {
  return input
    .split("\n")
    .map((line) => {
      if (!line.includes("\r")) return line;
      const parts = line.split("\r");
      return parts[parts.length - 1] || "";
    })
    .join("\n");
}

export function normalizeTerminalChunk(input: string): string {
  let out = input;
  out = out.replace(OSC_RE, "");
  out = out.replace(OTHER_ESC_RE, "");
  out = stripAnsi(out);
  out = squashCarriageReturns(out);
  out = out.replace(C0_CTRL_RE, "");
  return out;
}

export function extractTokenDelta(text: string) {
  const lower = text.toLowerCase();
  const input = /input[^0-9]{0,12}(\d{1,9})/.exec(lower);
  const output = /output[^0-9]{0,12}(\d{1,9})/.exec(lower);
  return {
    approx_input_tokens: input ? Number(input[1]) : 0,
    approx_output_tokens: output ? Number(output[1]) : 0,
  };
}
