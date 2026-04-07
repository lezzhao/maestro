import { DEFAULT_ENGINE_ID, DEFAULT_PROFILE_ID } from "../../constants";
import { createTaskCommand, deleteTaskCommand } from "../../hooks/commands/task-commands";
import type { AppTask, TaskViewState } from "../../types";
import type { SetFn, GetFn } from "./types";

export function createTaskActions(set: SetFn, get: GetFn) {
  return {
    addTask: async (name: string, workspaceIdParam?: string | null) => {
      const title = name || `Task ${get().tasks.length + 1}`;
      try {
        const engines = get().engines;
        if (Object.keys(engines).length === 0) {
          throw new Error("No AI Engines configured. Please go to Settings and add a provider (e.g. OpenAI, Anthropic) first.");
        }
        const activeWorkspaceId = workspaceIdParam !== undefined ? workspaceIdParam : get().activeWorkspaceId;
        const activeWorkspace = get().workspaces.find((workspace) => workspace.id === activeWorkspaceId) || null;
        const workingDirectory = activeWorkspace?.workingDirectory?.trim() || "";
        const workspaceBoundary = workingDirectory
          ? JSON.stringify({ root: workingDirectory })
          : "{}";
        const defaultEngine = Object.keys(engines).sort()[0] || DEFAULT_ENGINE_ID;
        const engine = engines[defaultEngine];
        const defaultProfile =
          engine?.active_profile_id && engine?.profiles?.[engine.active_profile_id]
            ? engine.active_profile_id
            : engine?.profiles
              ? Object.keys(engine.profiles)[0]
              : DEFAULT_PROFILE_ID;

        await createTaskCommand({
          title,
          description: "",
          engineId: defaultEngine,
          workspaceBoundary,
          profileId: defaultProfile,
          workspaceId: activeWorkspaceId,
        });
      } catch (e) {
        console.error("Failed to add task:", e);
        throw e;
      }
    },
    setTasks: (tasks: AppTask[]) => set({ tasks }),
    removeTask: (id: string) => {
      const prevTasks = get().tasks;
      const prevActive = get().activeTaskId;
      
      set({
        tasks: prevTasks.filter((t) => t.id !== id),
        activeTaskId: prevActive === id ? null : prevActive
      });

      void deleteTaskCommand(id).catch((e) => {
        console.error("Failed to remove task:", e);
        set({
          tasks: prevTasks,
          activeTaskId: prevActive
        });
      });
    },
    setActiveTaskId: (activeTaskId: string | null) => set({ activeTaskId }),
    updateTaskRecord: (id: string, patch: Partial<TaskViewState>) =>
      set((state) => ({
        tasks: state.tasks.map((t) =>
          t.id === id ? { ...t, ...patch, updated_at: Date.now() } : t
        ),
      })),
    setTaskResolvedRuntimeContext: (id: string, ctx: import("../../types").ResolvedRuntimeContext | null) =>
      set((state) => ({
        tasks: state.tasks.map((t) =>
          t.id === id ? { ...t, resolvedRuntimeContext: ctx } : t
        ),
      })),
    updateTaskRuntimeBinding: (id: string, patch: Partial<import("../../types").TaskRuntimeBinding>) =>
      set((state) => ({
        tasks: state.tasks.map((t) =>
          t.id === id ? ({ ...t, ...patch } as AppTask) : t
        ),
      })),
  };
}
