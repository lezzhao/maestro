import { useEffect, useRef } from "react";
import { useEngine } from "./useEngine";

export function useAppLifecycle(
  activeExecutionMode: "api" | "cli",
  activeEngineId: string,
  activeTaskId: string | null,
) {
  const { engines, enginePreflight, switchEngine } = useEngine();
  const autoSelectDoneRef = useRef(false);
  const autoSelectingRef = useRef(false);

  useEffect(() => {
    if (autoSelectDoneRef.current || Object.keys(engines).length === 0) return;
    // 有活动任务时不要自动切换引擎，避免无感改写任务绑定。
    if (activeTaskId) return;
    if (activeExecutionMode === "api") {
      autoSelectDoneRef.current = true;
      return;
    }
    const engineLevelEntries = Object.entries(enginePreflight).filter(
      ([key]) => !key.includes("::"),
    );
    const readyEngineId = engineLevelEntries.find(
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
    const checked = engineLevelEntries.length;
    if (checked >= Object.keys(engines).length) {
      autoSelectDoneRef.current = true;
    }
  }, [activeEngineId, activeExecutionMode, activeTaskId, enginePreflight, engines, switchEngine]);
}
