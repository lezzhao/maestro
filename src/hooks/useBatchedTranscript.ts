/**
 * Batches transcript chunks to reduce store updates during high-frequency streaming.
 * Flushes every FLUSH_INTERVAL_MS or when buffer exceeds FLUSH_THRESHOLD_BYTES.
 */
import { useCallback, useRef } from "react";

const FLUSH_INTERVAL_MS = 50;
const FLUSH_THRESHOLD_BYTES = 16384;

export function useBatchedTranscript(
  appendRunTranscript: (runId: string, content: string) => void,
) {
  const bufferRef = useRef<{ runId: string; chunks: string[]; size: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const buf = bufferRef.current;
    if (!buf || buf.chunks.length === 0) return;
    const content = buf.chunks.join("");
    bufferRef.current = null;
    appendRunTranscript(buf.runId, content);
  }, [appendRunTranscript]);

  const appendChunk = useCallback(
    (runId: string, chunk: string) => {
      if (!chunk) return;

      const buf = bufferRef.current;
      if (buf && buf.runId === runId) {
        buf.chunks.push(chunk);
        buf.size += chunk.length;
        if (buf.size >= FLUSH_THRESHOLD_BYTES) {
          flush();
        } else if (!timerRef.current) {
          timerRef.current = setTimeout(flush, FLUSH_INTERVAL_MS);
        }
      } else {
        if (buf) flush();
        bufferRef.current = {
          runId,
          chunks: [chunk],
          size: chunk.length,
        };
        timerRef.current = setTimeout(flush, FLUSH_INTERVAL_MS);
      }
    },
    [flush],
  );

  const flushNow = useCallback(() => {
    flush();
  }, [flush]);

  return { appendChunk, flushNow };
}
