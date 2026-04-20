import { useCallback, useRef } from "react";
import { ExecutionClient, type ExecutionEvent } from "../services/ExecutionClient";

export function useAgentExecutor(
  executionMode: "api" | "cli",
  onEvent: (event: ExecutionEvent) => void
) {
  const currentClientRef = useRef<ExecutionClient | null>(null);

  const startExecution = useCallback(
    async (taskId: string, request: Record<string, unknown>, providedCycleId?: string) => {
      if (currentClientRef.current) {
        await currentClientRef.current.stop();
      }
      // Use provided cycleId or generate a unique token for this execution cycle (Fix 3)
      const cycleId = providedCycleId || `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const client = new ExecutionClient(taskId, cycleId, executionMode, onEvent);
      currentClientRef.current = client;
      
      const result = await client.start({ ...request, state_token: cycleId });
      return { ...result, cycleId };
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
