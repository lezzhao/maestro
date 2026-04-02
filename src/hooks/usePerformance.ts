import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { usePerformanceStoreState } from "./use-app-store-selectors";
import { stopProcessMonitorCommand, startProcessMonitorCommand } from "./commands/performance-commands";

interface ProcessStats {
  cpu_percent: number;
  memory_mb: number;
}

export function usePerformance() {
  const { tasks, activeTaskId, currentStep, updateTaskRecord } = usePerformanceStoreState();
  const activeTask = tasks.find((task) => task.id === activeTaskId);
  const sessionId = activeTask?.sessionId ?? null;
  const activeExecId = activeTask?.activeExecId ?? null;
  const stateRef = useRef({ tasks, activeTaskId, updateTaskRecord });

  useEffect(() => {
    stateRef.current = { tasks, activeTaskId, updateTaskRecord };
  }, [tasks, activeTaskId, updateTaskRecord]);

  // Effect 1: Perf Stats Listener (Global, but only updates active task)
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    
    const setupListener = async () => {
      try {
        const unlistenFn = await listen<ProcessStats>("perf://stats", (event) => {
          const { activeTaskId: tid, tasks: currentTasks, updateTaskRecord: syncTaskRecord } = stateRef.current;
          if (!tid) return;
          const task = currentTasks.find((t) => t.id === tid);
          const prev = task?.stats;
          syncTaskRecord(tid, {
            stats: {
              cpu_percent: event.payload.cpu_percent,
              memory_mb: event.payload.memory_mb,
              approx_input_tokens: prev?.approx_input_tokens ?? 0,
              approx_output_tokens: prev?.approx_output_tokens ?? 0,
            },
          });
        });
        unlisten = unlistenFn;
      } catch (err) {
        console.error("[usePerformance] Failed to setup listener:", err);
      }
    };

    void setupListener();

    return () => {
      unlisten?.();
    };
  }, []);

  // Effect 2: Monitor Toggle (Depends on sessionId and step)
  useEffect(() => {
    if (currentStep !== "compose") {
      void stopProcessMonitorCommand().catch(() => {});
      return;
    }
    if (!sessionId) {
      // headless 执行没有 PTY session，可用 exec 但不可用 process monitor
      if (activeExecId) {
        void stopProcessMonitorCommand().catch(() => {});
      }
      return;
    }

    void startProcessMonitorCommand(sessionId).catch((err) => {
      console.error("[usePerformance] Failed to start monitor:", err);
    });

    return () => {
      void stopProcessMonitorCommand().catch(() => {});
    };
  }, [activeExecId, currentStep, sessionId]);
}
