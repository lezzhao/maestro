import { create } from "zustand";
import { persist } from "zustand/middleware";

import { DEFAULT_ENGINE_ID, DEFAULT_PROFILE_ID } from "../constants";
import { createTaskCommand, deleteTaskCommand } from "../hooks/task-commands";
import type {
  EngineConfig,
  EnginePreflightResult,
  AppTask,
  TaskViewState,
  Workspace,
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
  theme: "light" | "dark" | "system";
  lang: "en" | "zh";

  // Task Management
  tasks: AppTask[];
  activeTaskId: string | null;

  // Workspace Management
  workspaces: Workspace[];
  activeWorkspaceId: string | null;

  // Actions
  setCurrentStep: (step: "setup" | "project" | "compose" | "review") => void;
  setShowSettings: (show: boolean) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setAutoRetry: (enabled: boolean) => void;
  setProjectPath: (path: string) => void;
  setEngines: (engines: Record<string, EngineConfig>) => void;
  setEnginePreflight: (engineId: string, result: EnginePreflightResult) => void;
  setSpecProvider: (provider: "none" | "bmad" | "custom") => void;
  setTheme: (theme: "light" | "dark" | "system") => void;
  setLang: (lang: "en" | "zh") => void;

  // Task Actions
  /** 创建任务（事件驱动：后端 task_created 事件会自动同步到列表，无需返回值） */
  addTask: (name: string) => Promise<void>;
  setTasks: (tasks: AppTask[]) => void;
  removeTask: (id: string) => void;
  setActiveTaskId: (id: string | null) => void;
  /** Updates task record fields only (id, name, status, gitChanges, stats, created_at, updated_at). */
  updateTaskRecord: (id: string, patch: Partial<TaskViewState>) => void;
  setTaskResolvedRuntimeContext: (id: string, ctx: import("../types").ResolvedRuntimeContext | null) => void;
  updateTaskRuntimeBinding: (id: string, patch: Partial<import("../types").TaskRuntimeBinding>) => void;

  // Workspace Actions
  setWorkspaces: (workspaces: Workspace[]) => void;
  addWorkspace: (ws: Workspace) => void;
  updateWorkspace: (id: string, patch: Partial<Workspace>) => void;
  removeWorkspace: (id: string) => void;
  setActiveWorkspaceId: (id: string | null) => void;
};

export const useAppStore = create<AppStore>()(
  persist(
    (set, get) => ({
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
          const activeWorkspaceId = get().activeWorkspaceId;
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
      setTasks: (tasks) => set({ tasks }),
      removeTask: (id) => {
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

      // Workspace Actions
      setWorkspaces: (workspaces) => set({ workspaces }),
      addWorkspace: (ws) =>
        set((state) => {
          if (state.workspaces.some((w) => w.id === ws.id)) return state;
          return {
            workspaces: [ws, ...state.workspaces],
            activeWorkspaceId: state.activeWorkspaceId || ws.id,
          };
        }),
      updateWorkspace: (id, patch) =>
        set((state) => ({
          workspaces: state.workspaces.map((w) =>
            w.id === id ? { ...w, ...patch, updatedAt: Date.now() } : w
          ),
        })),
      removeWorkspace: (id) =>
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
      setActiveWorkspaceId: (activeWorkspaceId) => set({ activeWorkspaceId }),
    }),
    {
      name: "maestro-app-storage",
      partialize: (state) => ({
        projectPath: state.projectPath,
        theme: state.theme,
        lang: state.lang,
        sidebarCollapsed: state.sidebarCollapsed,
        autoRetry: state.autoRetry,
        activeTaskId: state.activeTaskId,
        activeWorkspaceId: state.activeWorkspaceId,
      }),
    }
  )
);
