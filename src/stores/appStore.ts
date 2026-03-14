import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  EngineConfig,
  EnginePreflightResult,
  FileTreeNode,
  AppTask,
} from "../types";

type AppStore = {
  currentStep: "setup" | "project" | "compose" | "review";
  showSettings: boolean;
  sidebarCollapsed: boolean;
  autoRetry: boolean;
  projectPath: string;
  fileTree: FileTreeNode[] | null;
  engines: Record<string, EngineConfig>;
  enginePreflight: Record<string, EnginePreflightResult>;
  activeEngineId: string;
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
  setFileTree: (tree: FileTreeNode[] | null) => void;
  setEngines: (engines: Record<string, EngineConfig>) => void;
  setEnginePreflight: (engineId: string, result: EnginePreflightResult) => void;
  setActiveEngineId: (id: string) => void;
  setSpecProvider: (provider: "none" | "bmad" | "custom") => void;
  setErrorMessage: (message: string | null) => void;
  setTheme: (theme: "light" | "dark" | "system") => void;
  setLang: (lang: "en" | "zh") => void;

  // Task Actions
  addTask: (name: string) => AppTask;
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
    fileTree: null,
    engines: {},
    enginePreflight: {},
    activeEngineId: "cursor",
    specProvider: "none",
    errorMessage: null,
    theme: (localStorage.getItem("theme") as any) || "system",
    lang: (localStorage.getItem("lang") as any) || (navigator.language.startsWith("zh") ? "zh" : "en"),

    tasks: [],
    activeTaskId: null,

    setCurrentStep: (currentStep) => set({ currentStep }),
    setShowSettings: (showSettings) => set({ showSettings }),
    setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
    setAutoRetry: (autoRetry) => set({ autoRetry }),
    setProjectPath: (projectPath) => set({ projectPath }),
    setFileTree: (fileTree) => set({ fileTree }),
    setEngines: (engines) => set({ engines }),
    setEnginePreflight: (engineId, result) =>
      set((state) => ({
        enginePreflight: { ...state.enginePreflight, [engineId]: result },
      })),
    setActiveEngineId: (activeEngineId) => set({ activeEngineId }),
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

    addTask: (name) => {
      // Fallback for randomUUID if not available in insecure context or older engines
      const generateId = () => {
        if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
          return crypto.randomUUID();
        }
        return `task-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      };

      const newTask: AppTask = {
        id: generateId(),
        name: name || `Task ${get().tasks.length + 1}`,
        sessionId: null,
        status: "idle",
        gitChanges: [],
        stats: {
          cpu_percent: 0,
          memory_mb: 0,
          approx_input_tokens: 0,
          approx_output_tokens: 0,
        },
        created_at: Date.now(),
        updated_at: Date.now(),
      };
      set((state) => ({
        tasks: [newTask, ...state.tasks],
        activeTaskId: newTask.id,
      }));
      return newTask;
    },
    removeTask: (id) =>
      set((state) => ({
        tasks: state.tasks.filter((t) => t.id !== id),
        activeTaskId: state.activeTaskId === id ? (state.tasks[1]?.id || null) : state.activeTaskId,
      })),
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
