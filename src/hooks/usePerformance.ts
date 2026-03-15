import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../stores/appStore";

interface ProcessStats {
  cpu_percent: number;
  memory_mb: number;
}

export function usePerformance() {
  const activeTaskId = useAppStore((s) => s.activeTaskId);
  const currentStep = useAppStore((s) => s.currentStep);
  const activeTask = useAppStore((s) => s.tasks.find((task) => task.id === s.activeTaskId));
  const sessionId = activeTask?.sessionId ?? null;
  const activeExecId = activeTask?.activeExecId ?? null;

  // Effect 1: Perf Stats Listener (Global, but only updates active task)
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    
    const setupListener = async () => {
      try {
        const unlistenFn = await listen<ProcessStats>("perf://stats", (event) => {
          const state = useAppStore.getState();
          const tid = state.activeTaskId;
          if (!tid) return;
          const task = state.tasks.find((t) => t.id === tid);
          const prev = task?.stats;
          state.updateTask(tid, {
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
  }, [activeTaskId]);

  // Effect 2: Monitor Toggle (Depends on sessionId and step)
  useEffect(() => {
    if (currentStep !== "compose") {
      void invoke("process_stop_monitor").catch(() => {});
      return;
    }
    if (!sessionId) {
      // headless 执行没有 PTY session，可用 exec 但不可用 process monitor
      if (activeExecId) {
        void invoke("process_stop_monitor").catch(() => {});
      }
      return;
    }

    void invoke("process_start_monitor", { sessionId, intervalMs: 2500 }).catch((err) => {
      console.error("[usePerformance] Failed to start monitor:", err);
    });

    return () => {
      void invoke("process_stop_monitor").catch(() => {});
    };
  }, [activeExecId, currentStep, sessionId]);
}
