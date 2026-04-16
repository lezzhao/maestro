import { invoke } from "@tauri-apps/api/core";

export interface HarnessSession {
  task_id: string;
  current_mode: "strategic" | "action" | "review";
  strategic_plan?: string;
  metadata: Record<string, any>;
  updated_at: number;
}

export const harnessCommands = {
  getSession: async (taskId: string): Promise<HarnessSession> => {
    return invoke("harness_get_session", { taskId });
  },
  
  transition: async (taskId: string, newMode: string): Promise<void> => {
    return invoke("harness_transition", { taskId, newMode });
  },
  
  updatePlan: async (taskId: string, plan: string): Promise<void> => {
    return invoke("harness_update_plan", { taskId, plan });
  }
};
