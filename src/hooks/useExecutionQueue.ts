import { useState, useCallback, useRef } from "react";

export type QueueItem = {
  content: string;
  mode: "api" | "cli";
};

export function useExecutionQueue() {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const queueRef = useRef<QueueItem[]>([]); // Keep sync ref for immediate access

  const pushQueue = useCallback((item: QueueItem) => {
    queueRef.current.push(item);
    setQueue([...queueRef.current]);
  }, []);

  const popQueue = useCallback((): QueueItem | undefined => {
    const shifted = queueRef.current.shift();
    setQueue([...queueRef.current]);
    return shifted;
  }, []);

  const clearQueue = useCallback(() => {
    queueRef.current = [];
    setQueue([]);
  }, []);

  return { queue, pushQueue, popQueue, clearQueue, setQueue };
}
