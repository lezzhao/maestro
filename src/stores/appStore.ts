import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AppStore } from "./app/types";
import { createTaskActions } from "./app/task-actions";
import { createWorkspaceActions } from "./app/workspace-actions";
import { createUIActions } from "./app/ui-actions";
import { createEngineActions } from "./app/engine-actions";

export const useAppStore = create<AppStore>()(
  persist(
    (set, get) => ({
      // --- Initial State ---
      currentStep: "setup",
      showSettings: false,
      sidebarCollapsed: false,
      autoRetry: true,
      projectPath: "",
      engines: {},
      enginePreflight: {},
      specProvider: "none",
      theme: (() => {
        try {
          return (localStorage.getItem("theme") as "light" | "dark" | "system") || "system";
        } catch {
          return "system";
        }
      })(),
      lang: (() => {
        try {
          const stored = localStorage.getItem("lang");
          if (stored === "zh" || stored === "en") return stored;
          return typeof navigator?.language === "string" && navigator.language.startsWith("zh") ? "zh" : "en";
        } catch {
          return "en";
        }
      })(),

      tasks: [],
      activeTaskId: null,

      workspaces: [],
      activeWorkspaceId: null,

      activeArtifact: null,
      isArtifactsPanelOpen: false,

      pinnedFiles: [],

      isBootstrapped: false,
      maxConcurrentTasks: 3,

      // --- Actions (Sliced) ---
      ...createUIActions(set, get),
      ...createTaskActions(set, get),
      ...createWorkspaceActions(set, get),
      ...createEngineActions(set, get),
    }),
    {
      name: "maestro-app-storage",
      partialize: (state) => ({
        projectPath: state.projectPath,
        theme: state.theme,
        lang: state.lang,
        sidebarCollapsed: state.sidebarCollapsed,
        autoRetry: state.autoRetry,
        maxConcurrentTasks: state.maxConcurrentTasks,
        activeTaskId: state.activeTaskId,
        activeWorkspaceId: state.activeWorkspaceId,
      }),
    }
  )
);

export type { AppStore };
