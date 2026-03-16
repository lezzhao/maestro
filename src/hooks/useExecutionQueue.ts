import { useRef, useCallback } from "react";

export type QueueItem = {
  content: string;
  mode: "api" | "cli";
};

export function useExecutionQueue() {
  const queueRef = useRef<QueueItem[]>([]);

  const pushQueue = useCallback((item: QueueItem) => {
    queueRef.current.push(item);
  }, []);

  const popQueue = useCallback((): QueueItem | undefined => {
    return queueRef.current.shift();
  }, []);

  const clearQueue = useCallback(() => {
    queueRef.current = [];
  }, []);

  return { pushQueue, popQueue, clearQueue };
}
