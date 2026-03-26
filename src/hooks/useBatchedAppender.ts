/**
 * Batches text chunks to reduce store updates during high-frequency streaming.
 * Flushes every FLUSH_INTERVAL_MS or when buffer exceeds FLUSH_THRESHOLD_BYTES.
 */
import { useCallback, useRef, useMemo } from "react";

const FLUSH_INTERVAL_MS = 50;
const FLUSH_THRESHOLD_BYTES = 16384;

export function useBatchedAppender<T1 extends string, T2 extends string>(
  appendFunction: (id1: T1, id2: T2, content: string) => void,
) {
  const bufferRef = useRef<{ id1: T1; id2: T2; chunks: string[]; size: number } | null>(null);
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
    appendFunction(buf.id1, buf.id2, content);
  }, [appendFunction]);

  const appendChunk = useCallback(
    (id1: T1, id2: T2, chunk: string) => {
      if (!chunk) return;

      const buf = bufferRef.current;
      if (buf && buf.id1 === id1 && buf.id2 === id2) {
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
          id1,
          id2,
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

  return useMemo(() => ({ appendChunk, flushNow }), [appendChunk, flushNow]);
}
