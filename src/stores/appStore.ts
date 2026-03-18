import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

import { DEFAULT_ENGINE_ID, DEFAULT_PROFILE_ID } from "../constants";
import type {
  EngineConfig,
  EnginePreflightResult,
  AppTask,
  TaskViewState,
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
  /** Updates task record fields only (id, name, status, gitChanges, stats, created_at, updated_at). */
  updateTaskRecord: (id: string, patch: Partial<TaskViewState>) => void;
  setTaskResolvedRuntimeContext: (id: string, ctx: import("../types").ResolvedRuntimeContext | null) => void;
  updateTaskRuntimeBinding: (id: string, patch: Partial<import("../types").TaskRuntimeBinding>) => void;
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
        // Deterministic default engine: first by sorted key order, fallback to constant.
        const engines = get().engines;
        const defaultEngine = Object.keys(engines).sort()[0] || DEFAULT_ENGINE_ID;
        const engine = engines[defaultEngine];
        const defaultProfile =
          engine?.active_profile_id && engine?.profiles?.[engine.active_profile_id]
            ? engine.active_profile_id
            : engine?.profiles
              ? Object.keys(engine.profiles)[0]
              : DEFAULT_PROFILE_ID;

        await invoke("task_create", {
          request: {
            title,
            description: "",
            engineId: defaultEngine,
            workspaceBoundary: "",
            profileId: defaultProfile,
          },
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
    updateTaskRecord: (id, patch) =>
      set((state) => ({
        tasks: state.tasks.map((t) =>
          t.id === id ? { ...t, ...patch, updated_at: Date.now() } : t
        ),
      })),
    setTaskResolvedRuntimeContext: (id, ctx) =>
      set((state) => ({
        tasks: state.tasks.map((t) =>
          t.id === id ? { ...t, resolvedRuntimeContext: ctx } : t
        ),
      })),
    updateTaskRuntimeBinding: (id, patch) =>
      set((state) => ({
        tasks: state.tasks.map((t) =>
          t.id === id ? ({ ...t, ...patch } as AppTask) : t
        ),
      })),
  })
);
