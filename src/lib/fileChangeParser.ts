import type { ChatMessage, FileChange } from "../types";

/**
 * Extracts explicit file modifications declared by the AI from chat messages.
 * We rely on standard XML tag responses, JSON payloads, or explicit tool log statements.
 *
 * This cleanly decouples the frontend "Git/File Changes" list from the global Git repository.
 */
export function parseTaskFileChanges(messages: ChatMessage[]): FileChange[] {
  if (!messages || messages.length === 0) return [];
  const files = new Set<string>();

  messages.forEach((msg) => {
    if (msg.role !== "assistant") return;

    // Pattern 1: XML tags <edit_file>path</edit_file> or <write_to_file>path</write_to_file>
    const xmlMatches = msg.content.matchAll(
      /<(?:edit|write_to|create|delete)_file>\s*([^\s<>]+)/gi,
    );
    for (const m of xmlMatches) files.add(m[1]);

    // Pattern 2: Typical JSON tool args `{"path": "src/..."}`
    const jsonPathMatches = msg.content.matchAll(/"(?:file_)?path"\s*:\s*"([^"]+)"/g);
    for (const m of jsonPathMatches) {
      if (!m[1].includes(" ") && m[1].includes("/")) files.add(m[1]);
    }

    // Pattern 3: CLI outputs like "File edited: src/..." or "Created file: src/..."
    const logMatches = msg.content.matchAll(
      /(?:edit|create|update|modif)y?(?:ed|ing)?\s+file:?\s+([^\s\n]+)/gi,
    );
    for (const m of logMatches) {
      if (!m[1].startsWith("{") && !m[1].includes("(") && m[1].includes("/")) {
        files.add(m[1]);
      }
    }
  });

  return Array.from(files).map((path) => ({
    path,
    status: "modified" as const,
  }));
}
