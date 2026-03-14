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
  // Use a ref for the updater to avoid useEffect dependency changes
  
  // Only watch sessionId if we really need to trigger the monitor toggle
  const sessionId = useAppStore((s) => s.tasks.find(t => t.id === s.activeTaskId)?.sessionId);

  // Effect 1: Perf Stats Listener (Global, but only updates active task)
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    
    console.log("[usePerformance] Setting up listener for taskId:", activeTaskId);
    
    const setupListener = async () => {
      try {
        const unlistenFn = await listen<ProcessStats>("perf://stats", (event) => {
          const state = useAppStore.getState();
          const tid = state.activeTaskId;
          if (!tid) return;
          
          // Use updateTask directly to avoid any stability issues with updateActiveTask
          state.updateTask(tid, {
            stats: {
              ...(useAppStore.getState().tasks.find(t => t.id === tid)?.stats || {}),
              cpu_percent: event.payload.cpu_percent,
              memory_mb: event.payload.memory_mb,
            }
          } as any);
        });
        unlisten = unlistenFn;
      } catch (err) {
        console.error("[usePerformance] Failed to setup listener:", err);
      }
    };

    void setupListener();
    
    return () => {
      if (unlisten) {
        console.log("[usePerformance] Cleaning up listener");
        unlisten();
      }
    };
  }, [activeTaskId]);

  // Effect 2: Monitor Toggle (Depends on sessionId and step)
  useEffect(() => {
    if (!sessionId || currentStep !== "compose") {
      void invoke("process_stop_monitor").catch(() => {});
      return;
    }

    console.log("[usePerformance] Starting monitor for sessionId:", sessionId);
    void invoke("process_start_monitor", { sessionId, intervalMs: 2500 }).catch(err => {
      console.error("[usePerformance] Failed to start monitor:", err);
    });

    return () => {
      void invoke("process_stop_monitor").catch(() => {});
    };
  }, [sessionId, currentStep]);
}
