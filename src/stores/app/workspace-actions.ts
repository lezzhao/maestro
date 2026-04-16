import type { Workspace } from "../../types";
import type { SetFn, GetFn } from "./types";

export function createWorkspaceActions(set: SetFn, _get: GetFn) {
  return {
    setWorkspaces: (workspaces: Workspace[]) => set({ workspaces }),
    addWorkspace: (ws: Workspace) =>
      set((state) => {
        if (state.workspaces.some((w) => w.id === ws.id)) return state;
        return {
          workspaces: [ws, ...state.workspaces],
          activeWorkspaceId: state.activeWorkspaceId || ws.id,
        };
      }),
    updateWorkspace: (id: string, patch: Partial<Workspace>) =>
      set((state) => ({
        workspaces: state.workspaces.map((w) =>
          w.id === id ? { ...w, ...patch, updatedAt: Date.now() } : w
        ),
      })),
    removeWorkspace: (id: string) =>
      set((state) => {
        const remaining = state.workspaces.filter((w) => w.id !== id);
        return {
          workspaces: remaining,
          activeWorkspaceId:
            state.activeWorkspaceId === id
              ? remaining[0]?.id || null
              : state.activeWorkspaceId,
        };
      }),
    setActiveWorkspaceId: (activeWorkspaceId: string | null) => set({ activeWorkspaceId }),
    togglePinnedFile: (path: string) =>
      set((state) => {
        const isPinned = state.pinnedFiles.includes(path);
        return {
          pinnedFiles: isPinned
            ? state.pinnedFiles.filter((f) => f !== path)
            : [...state.pinnedFiles, path],
        };
      }),
  };
}
