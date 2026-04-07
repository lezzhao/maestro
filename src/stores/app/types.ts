import type {
  EngineConfig,
  EnginePreflightResult,
  AppTask,
  Workspace,
} from "../../types";

export type AppState = {
  currentStep: "setup" | "project" | "compose" | "review";
  showSettings: boolean;
  sidebarCollapsed: boolean;
  autoRetry: boolean;
  projectPath: string;
  engines: Record<string, EngineConfig>;
  enginePreflight: Record<string, EnginePreflightResult>;
  specProvider: "none" | "maestro" | "custom";
  theme: "light" | "dark" | "system";
  lang: "en" | "zh";

  // Task Management
  tasks: AppTask[];
  activeTaskId: string | null;

  // Workspace Management
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  
  // Artifacts
  activeArtifact: { code: string; language: string; title?: string } | null;
  isArtifactsPanelOpen: boolean;
  
  // Context Pinning
  pinnedFiles: string[];
  maxConcurrentTasks: number;

  isBootstrapped: boolean;
};

export type AppActions = {
  setCurrentStep: (step: AppState["currentStep"]) => void;
  setShowSettings: (show: boolean) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setAutoRetry: (enabled: boolean) => void;
  setProjectPath: (path: string) => void;
  setEngines: (engines: Record<string, EngineConfig>) => void;
  setEnginePreflight: (engineId: string, result: EnginePreflightResult) => void;
  setSpecProvider: (provider: AppState["specProvider"]) => void;
  setTheme: (theme: AppState["theme"]) => void;
  setLang: (lang: AppState["lang"]) => void;
  setBootstrapped: (ready: boolean) => void;
  setMaxConcurrentTasks: (count: number) => void;

  // Task Actions
  addTask: (name: string, workspaceId?: string | null) => Promise<void>;
  setTasks: (tasks: AppTask[]) => void;
  removeTask: (id: string) => void;
  setActiveTaskId: (id: string | null) => void;
  updateTaskRecord: (id: string, patch: Partial<import("../../types").TaskViewState>) => void;
  setTaskResolvedRuntimeContext: (id: string, ctx: import("../../types").ResolvedRuntimeContext | null) => void;
  updateTaskRuntimeBinding: (id: string, patch: Partial<import("../../types").TaskRuntimeBinding>) => void;

  // Workspace Actions
  setWorkspaces: (workspaces: Workspace[]) => void;
  addWorkspace: (ws: Workspace) => void;
  updateWorkspace: (id: string, patch: Partial<Workspace>) => void;
  removeWorkspace: (id: string) => void;
  setActiveWorkspaceId: (id: string | null) => void;

  // Artifact Actions
  setActiveArtifact: (artifact: AppState["activeArtifact"]) => void;
  setArtifactsPanelOpen: (open: boolean) => void;

  // Context Actions
  togglePinFile: (path: string) => void;
  clearPinnedFiles: () => void;
};

export type AppStore = AppState & AppActions;

export type SetFn = (partial: Partial<AppStore> | ((state: AppStore) => Partial<AppStore>)) => void;
export type GetFn = () => AppStore;
