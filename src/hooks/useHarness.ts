import { useState, useEffect, useCallback } from 'react';
import { harnessCommands, HarnessSession } from './commands/harness-commands';

export function useHarness(taskId?: string) {
  const [session, setSession] = useState<HarnessSession | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshSession = useCallback(async () => {
    if (!taskId) return;
    setIsLoading(true);
    try {
      const data = await harnessCommands.getSession(taskId);
      setSession(data);
      setError(null);
    } catch (err) {
      console.error('Failed to fetch harness session:', err);
      setError(String(err));
    } finally {
      setIsLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  const transitionTo = async (newMode: "strategic" | "action" | "review") => {
    if (!taskId) return;
    try {
      await harnessCommands.transition(taskId, newMode);
      await refreshSession();
    } catch (err) {
      console.error('Failed to transition harness mode:', err);
      throw err;
    }
  };

  const updateStrategicPlan = async (plan: string) => {
    if (!taskId) return;
    try {
      await harnessCommands.updatePlan(taskId, plan);
      await refreshSession();
    } catch (err) {
      console.error('Failed to update strategic plan:', err);
      throw err;
    }
  };

  return {
    session,
    isLoading,
    error,
    refreshSession,
    transitionTo,
    updateStrategicPlan,
    currentMode: session?.current_mode || 'action', // Default fallback
  };
}
