import { useCallback, useRef } from "react";
import { ExecutionClient, type ExecutionEvent } from "../services/ExecutionClient";

export function useAgentExecutor(
  executionMode: "api" | "cli",
  onEvent: (event: ExecutionEvent) => void
) {
  const currentClientRef = useRef<ExecutionClient | null>(null);

  const startExecution = useCallback(
    async (request: Record<string, unknown>) => {
      if (currentClientRef.current) {
        await currentClientRef.current.stop();
      }
      const client = new ExecutionClient(executionMode, onEvent);
      currentClientRef.current = client;
      return await client.start(request);
    },
    [executionMode, onEvent]
  );

  const stopExecution = useCallback(async () => {
    if (currentClientRef.current) {
      await currentClientRef.current.stop();
      currentClientRef.current = null;
    }
  }, []);

  return { startExecution, stopExecution };
}
