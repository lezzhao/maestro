import type { AppState, SetFn, GetFn } from "./types";

export function createUIActions(set: SetFn, _get: GetFn) {
  return {
    setCurrentStep: (currentStep: AppState["currentStep"]) => set({ currentStep }),
    setShowSettings: (showSettings: boolean) => set({ showSettings }),
    setShowSkillGallery: (showSkillGallery: boolean) => set({ showSkillGallery }),
    setSidebarCollapsed: (sidebarCollapsed: boolean) => set({ sidebarCollapsed }),
    setAutoRetry: (autoRetry: boolean) => set({ autoRetry }),
    setProjectPath: (projectPath: string) => set({ projectPath }),
    setTheme: (theme: AppState["theme"]) => {
      localStorage.setItem("theme", theme);
      set({ theme });
    },
    setLang: (lang: AppState["lang"]) => {
      localStorage.setItem("lang", lang);
      set({ lang });
    },
    setBootstrapped: (isBootstrapped: boolean) => set({ isBootstrapped }),
    setMaxConcurrentTasks: (maxConcurrentTasks: number) => {
      import("../../hooks/commands/app-runtime-commands").then(({ updateMaxConcurrentTasksCommand }) => {
        updateMaxConcurrentTasksCommand(maxConcurrentTasks).catch(console.error);
      });
      set({ maxConcurrentTasks });
    },

    // Artifact Actions
    setActiveArtifact: (activeArtifact: AppState["activeArtifact"]) => set({ 
      activeArtifact, 
      isArtifactsPanelOpen: !!activeArtifact 
    }),
    setArtifactsPanelOpen: (isArtifactsPanelOpen: boolean) => set({ isArtifactsPanelOpen }),

    // Context Actions
    togglePinFile: (path: string) => set((state) => ({
      pinnedFiles: state.pinnedFiles.includes(path) 
        ? state.pinnedFiles.filter(p => p !== path)
        : [...state.pinnedFiles, path]
    })),
    clearPinnedFiles: () => set({ pinnedFiles: [] }),
  };
}
