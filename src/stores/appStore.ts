import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

import type {
  EngineConfig,
  EnginePreflightResult,
  AppTask,
} from "../types";

type AppStore = {
  currentStep: "setup" | "project" | "compose" | "review";
  showSettings: boolean;
  sidebarCollapsed: boolean;
  autoRetry: boolean;
  projectPath: string;
  engines: Record<string, EngineConfig>;
  enginePreflight: Record<string, EnginePreflightResult>;
  specProvider: "none" | "bmad" | "custom";
  errorMessage: string | null;
  theme: "light" | "dark" | "system";
  lang: "en" | "zh";

  // Task Management
  tasks: AppTask[];
  activeTaskId: string | null;

  // Actions
  setCurrentStep: (step: "setup" | "project" | "compose" | "review") => void;
  setShowSettings: (show: boolean) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setAutoRetry: (enabled: boolean) => void;
  setProjectPath: (path: string) => void;
  setEngines: (engines: Record<string, EngineConfig>) => void;
  setEnginePreflight: (engineId: string, result: EnginePreflightResult) => void;
  setSpecProvider: (provider: "none" | "bmad" | "custom") => void;
  setErrorMessage: (message: string | null) => void;
  setTheme: (theme: "light" | "dark" | "system") => void;
  setLang: (lang: "en" | "zh") => void;

  // Task Actions
  addTask: (name: string) => Promise<AppTask | null>;
  setTasks: (tasks: AppTask[]) => void;
  removeTask: (id: string) => void;
  setActiveTaskId: (id: string | null) => void;
  updateTask: (id: string, patch: Partial<AppTask>) => void;
  updateActiveTask: (patch: Partial<AppTask>) => void;
};

export const useAppStore = create<AppStore>()(
  (set, get) => ({
    currentStep: "setup",
    showSettings: false,
    sidebarCollapsed: false,
    autoRetry: true,
    projectPath: "",
    engines: {},
    enginePreflight: {},
    specProvider: "none",
    errorMessage: null,
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

    setCurrentStep: (currentStep) => set({ currentStep }),
    setShowSettings: (showSettings) => set({ showSettings }),
    setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
    setAutoRetry: (autoRetry) => set({ autoRetry }),
    setProjectPath: (projectPath) => set({ projectPath }),
    setEngines: (engines) => set({ engines }),
    setEnginePreflight: (engineId, result) =>
      set((state) => ({
        enginePreflight: { ...state.enginePreflight, [engineId]: result },
      })),
    setSpecProvider: (specProvider) => set({ specProvider }),
    setErrorMessage: (errorMessage) => set({ errorMessage }),
    setTheme: (theme) => {
      localStorage.setItem("theme", theme);
      set({ theme });
    },
    setLang: (lang) => {
      localStorage.setItem("lang", lang);
      set({ lang });
    },

    addTask: async (name) => {
      const title = name || `Task ${get().tasks.length + 1}`;
      try {
        // Find a default engine since we removed activeEngineId.
        const engines = get().engines;
        const defaultEngine = Object.keys(engines)[0] || "cursor";

        await invoke("task_create", {
          title,
          description: "",
          engine_id: defaultEngine,
          workspaceBoundary: "",
        });
        
        // We no longer manually create the TaskState here, we let the backend state broadcast 
        // the `TaskCreated` event which will be picked up by `agentStateReducer`.
        return null;
      } catch (e) {
        set({ errorMessage: String(e) });
        return null;
      }
    },
    setTasks: (tasks) => set({ tasks }),
    removeTask: (id) => {
      void invoke("task_delete", { taskId: id }).catch(
        (e) => set({ errorMessage: String(e) })
      );
    },
    setActiveTaskId: (activeTaskId) => set({ activeTaskId }),
    updateTask: (id, patch) =>
      set((state) => ({
        tasks: state.tasks.map((t) =>
          t.id === id ? { ...t, ...patch, updated_at: Date.now() } : t
        ),
      })),
    updateActiveTask: (patch) => {
      const id = get().activeTaskId;
      if (id) get().updateTask(id, patch);
    },
  })
);
