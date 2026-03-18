import { useEffect, useRef } from "react";
import { useEngine } from "./useEngine";

export function useAppLifecycle(activeExecutionMode: "api" | "cli", activeEngineId: string) {
  const { engines, enginePreflight, switchEngine } = useEngine();
  const autoSelectDoneRef = useRef(false);
  const autoSelectingRef = useRef(false);

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
