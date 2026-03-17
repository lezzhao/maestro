import { useEffect, useRef } from "react";
import { useEngine } from "./useEngine";

function runWhenIdle(task: () => void, timeout = 1200) {
  const win = window as any;
  if (typeof win.requestIdleCallback === "function") {
    const id = win.requestIdleCallback(task, { timeout });
    return () => win.cancelIdleCallback?.(id);
  }
  const timer = window.setTimeout(task, 180);
  return () => window.clearTimeout(timer);
}

export function useAppLifecycle(activeExecutionMode: "api" | "cli", activeEngineId: string) {
  const { engines, enginePreflight, preflightAll, switchEngine } = useEngine();
  const bootPreflightStartedRef = useRef(false);
  const autoSelectDoneRef = useRef(false);
  const autoSelectingRef = useRef(false);

  useEffect(() => {
    if (bootPreflightStartedRef.current) return;
    if (Object.keys(engines).length === 0) return;
    bootPreflightStartedRef.current = true;
    const cancel = runWhenIdle(() => {
      void preflightAll();
    });
    return cancel;
  }, [engines, preflightAll]);

  useEffect(() => {
    if (autoSelectDoneRef.current || Object.keys(engines).length === 0) return;
    if (activeExecutionMode === "api") {
      autoSelectDoneRef.current = true;
      return;
    }
    const readyEngineId = Object.entries(enginePreflight).find(
      ([, value]) => value.command_exists && value.auth_ok,
    )?.[0];
    if (readyEngineId) {
      if (readyEngineId === activeEngineId) {
        autoSelectDoneRef.current = true;
        return;
      }
      if (!autoSelectingRef.current) {
        autoSelectingRef.current = true;
        void switchEngine(readyEngineId).finally(() => {
          autoSelectingRef.current = false;
          autoSelectDoneRef.current = true;
        });
      }
      return;
    }
    const checked = Object.keys(enginePreflight).length;
    if (checked >= Object.keys(engines).length) {
      autoSelectDoneRef.current = true;
    }
  }, [activeEngineId, activeExecutionMode, enginePreflight, engines, switchEngine]);
}
