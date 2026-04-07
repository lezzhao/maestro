import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "../stores/appStore";

export function useAppUiState() {
  return useAppStore(useShallow((state) => ({
    showSettings: state.showSettings,
    setShowSettings: state.setShowSettings,
    setSidebarCollapsed: state.setSidebarCollapsed,
    theme: state.theme,
    setTheme: state.setTheme,
    lang: state.lang,
    setLang: state.setLang,
    activeWorkspaceId: state.activeWorkspaceId,
  })));
}

export function useThemeState() {
  return useAppStore((state) => state.theme);
}

export function useLanguageState() {
  return useAppStore((state) => state.lang);
}

export function useAppFlowState() {
  return useAppStore(useShallow((state) => ({
    currentStep: state.currentStep,
    setCurrentStep: state.setCurrentStep,
  })));
}

export function useWorkspaceStoreState() {
  return useAppStore(useShallow((state) => ({
    workspaces: state.workspaces,
    activeWorkspaceId: state.activeWorkspaceId,
    setActiveWorkspaceId: state.setActiveWorkspaceId,
    addWorkspace: state.addWorkspace,
    updateWorkspace: state.updateWorkspace,
    removeWorkspace: state.removeWorkspace,
  })));
}

export function useActiveWorkspace() {
  const { workspaces, activeWorkspaceId } = useWorkspaceStoreState();
  return useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceId) || null,
    [workspaces, activeWorkspaceId],
  );
}

export function useTaskStoreState() {
  return useAppStore(useShallow((state) => ({
    tasks: state.tasks,
    activeTaskId: state.activeTaskId,
    activeWorkspaceId: state.activeWorkspaceId,
    addTask: state.addTask,
    removeTask: state.removeTask,
    setActiveTaskId: state.setActiveTaskId,
    updateTaskRecord: state.updateTaskRecord,
    updateTaskRuntimeBinding: state.updateTaskRuntimeBinding,
    setTaskResolvedRuntimeContext: state.setTaskResolvedRuntimeContext,
    isBootstrapped: state.isBootstrapped,
  })));
}

export function useBootstrapState() {
  return useAppStore((state) => state.isBootstrapped);
}

export function useProjectStoreState() {
  return useAppStore(useShallow((state) => ({
    projectPath: state.projectPath,
    setProjectPath: state.setProjectPath,
  })));
}

export function useRuntimeStoreState() {
  return useAppStore(useShallow((state) => ({
    tasks: state.tasks,
    engines: state.engines,
    enginePreflight: state.enginePreflight,
  })));
}

export function useEngineStoreState() {
  return useAppStore(useShallow((state) => ({
    engines: state.engines,
    setEngines: state.setEngines,
    enginePreflight: state.enginePreflight,
    setEnginePreflight: state.setEnginePreflight,
  })));
}

export function usePerformanceStoreState() {
  return useAppStore(useShallow((state) => ({
    tasks: state.tasks,
    activeTaskId: state.activeTaskId,
    currentStep: state.currentStep,
    updateTaskRecord: state.updateTaskRecord,
  })));
}
