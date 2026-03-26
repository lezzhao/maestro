import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { invoke } from "@tauri-apps/api/core";
import { useActiveTask } from "../../hooks/useActiveTask";
import { useAppStore } from "../../stores/appStore";
import { useChatStore } from "../../stores/chatStore";
import { useTranslation } from "../../i18n";
import {
  Rocket,
  Plus,
} from "lucide-react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { Button } from "../ui/button";

import { SettingsView } from "../setup/SettingsView";
import { TaskWorkspace } from "../TaskWorkspace";
import { MainSidebar } from "../MainSidebar";
import { ActivityBar } from "./ActivityBar";
import { AppHeader } from "./AppHeader";
import { WorkspaceCreateDialog } from "../WorkspaceCreateDialog";
import { GitChangesPanel } from "../GitChangesPanel";
import { DiffDialog } from "../DiffDialog";
import { useEngine } from "../../hooks/useEngine";
import { useProject } from "../../hooks/useProject";
import { useAppLifecycle } from "../../hooks/useAppLifecycle";
import { useWorkspaceFlow } from "../../hooks/useWorkspaceFlow";
import { useTaskSwitchEffects } from "../../hooks/useTaskSwitchEffects";
import { useTaskRuntimeContext } from "../../hooks/useTaskRuntimeContext";
import { PanelFallback } from "../ui/PanelFallback";
import { toast } from "sonner";
import { parseTaskFileChanges } from "../../lib/fileChangeParser";
import type { Workspace } from "../../types";

export function WorkspaceLayout() {
  const { t } = useTranslation();

  const {
    engines,
    enginePreflight,
    switchEngine,
    preflightEngine,
    preflightAll,
    upsertEngine,
    setActiveProfile,
    updateTaskProfile,
    upsertProfile,
    listModels,
  } = useEngine();
  const { projectPath, detectAndRecommend, gitDiff } = useProject();
  const { activeTaskId, activeTask } = useActiveTask();
  const { 
    engineId: activeEngineId, 
    profileId: activeProfileId, 
    profile: activeProfile, 
    executionMode: activeExecutionMode, 
  } = useTaskRuntimeContext();
  const {
    showSettings, setShowSettings,
    setCurrentStep, setSidebarCollapsed,
    theme, setTheme,
    lang, setLang,
  } = useAppStore(useShallow((s) => ({
    showSettings: s.showSettings,
    setShowSettings: s.setShowSettings,
    setCurrentStep: s.setCurrentStep,
    setSidebarCollapsed: s.setSidebarCollapsed,
    theme: s.theme,
    setTheme: s.setTheme,
    lang: s.lang,
    setLang: s.setLang,
  })));

  const [activeFile, setActiveFile] = useState("");
  const [activeDiff, setActiveDiff] = useState("");
  const [diffOpen, setDiffOpen] = useState(false);

  const handleFileSelect = useCallback(async (path: string) => {
    if (!projectPath) return;
    setActiveFile(path);
    try {
      const diffStr = await gitDiff(path, projectPath);
      setActiveDiff(diffStr);
      setDiffOpen(true);
    } catch (e) {
      toast.error(`读取 diff 失败: ${String(e)}`);
      setActiveDiff("");
      setDiffOpen(false);
    }
  }, [projectPath, gitDiff]);

  const [showCreateWorkspace, setShowCreateWorkspace] = useState(false);
  const sidebarPanelRef = useRef<import("react-resizable-panels").PanelImperativeHandle>(null);

  const activeTaskMessages = useChatStore((s) => s.getTaskMessages(activeTaskId));



  useAppLifecycle(activeExecutionMode, activeEngineId);

  const { handleOpenProjectPicker } = useWorkspaceFlow({
    projectPath,
    showSettings,
    detectAndRecommend,
    setShowSettings,
    setCurrentStep,
  });

  const taskFileChanges = useMemo(
    () => parseTaskFileChanges(activeTaskMessages),
    [activeTaskMessages]
  );

  const handleSwitchEngine = async (engineId: string) => {
    if (!engineId || engineId === activeEngineId) return;
    try {
      await switchEngine(engineId);
    } catch (e) {
      toast.error(`${t("switch_engine_fail")}: ${String(e)}`);
    }
  };

  /** When switching profile: update task binding if we have active task on this engine, else update engine default. */
  const handleSetActiveProfile = useCallback(
    async (engineId: string, profileId: string) => {
      try {
        if (activeTaskId && engineId === activeEngineId) {
          await updateTaskProfile(activeTaskId, engineId, profileId);
        } else {
          await setActiveProfile(engineId, profileId);
        }
      } catch (e) {
        toast.error(`${t("switch_engine_fail")}: ${String(e)}`);
      }
    },
    [activeTaskId, activeEngineId, updateTaskProfile, setActiveProfile, t],
  );

  const handleSetExecutionMode = useCallback(
    async (mode: "api" | "cli") => {
      if (!activeEngineId || !activeProfileId || !activeProfile) return;
      if ((activeProfile.execution_mode || "cli") === mode) return;
      await upsertProfile(activeEngineId, activeProfileId, {
        ...activeProfile,
        execution_mode: mode,
      });
    },
    [activeEngineId, activeProfileId, activeProfile, upsertProfile],
  );

  useTaskSwitchEffects({
    activeTaskId,
    activeTaskMessagesLength: activeTaskMessages.length,
    setActiveFile: () => {},
    setActiveDiff: () => {},
  });

  useEffect(() => {
    if (projectPath && !showSettings) {
      const timer = setTimeout(() => {
        const panel = sidebarPanelRef.current;
        if (panel?.isCollapsed()) {
          panel.expand();
        }
        setSidebarCollapsed(false);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [projectPath, setSidebarCollapsed, showSettings]);

  // Load workspaces from backend on mount
  const setWorkspaces = useAppStore((s) => s.setWorkspaces);
  useEffect(() => {
    void invoke<Workspace[]>("workspace_list").then(setWorkspaces).catch(console.error);
  }, [setWorkspaces]);




  const trimmedProjectPath = projectPath?.trim();

  return (
    <div className="flex-1 h-full min-h-0 overflow-hidden relative flex">
      {/* Column 1: Workspace Bar */}
      <ActivityBar
        onOpenSettings={() => setShowSettings(!showSettings)}
        isSettingsOpen={showSettings}
        onCreateWorkspace={() => setShowCreateWorkspace(true)}
      />

      <div className="flex-1 h-full min-w-0 relative">
        {showSettings ? (
          <Suspense fallback={null}>
            <SettingsView
              engines={engines}
              enginePreflight={enginePreflight}
              activeEngineId={activeEngineId}
              onSwitch={handleSwitchEngine}
              onPreflight={preflightEngine}
              onPreflightAll={preflightAll}
              onSaveEngine={upsertEngine}
              onSetActiveProfile={handleSetActiveProfile}
              onUpsertProfile={upsertProfile}
              onFetchModels={listModels}
              theme={theme}
              onThemeChange={setTheme}
              lang={lang}
              onLangChange={setLang}
            />
          </Suspense>
        ) : (
          <Group 
            orientation="horizontal" 
            id="app-root-group" 
            className="w-full h-full"
          >
            {/* Column 2: Primary Left Sidebar */}
            <MainSidebar
              panelRef={sidebarPanelRef}
            />

            <Separator
              className="w-px bg-border-muted/50 hover:bg-primary-500 active:bg-primary-600 transition-colors cursor-col-resize z-50 -mx-[0.5px]"
            />

            <Panel id="panel-main" defaultSize={800} minSize={400} className="flex flex-col min-h-0 bg-bg-surface">
              {!trimmedProjectPath ? (
                  <div className="h-full flex flex-col items-center justify-center space-y-6">
                    <div className="relative group">
                      <div className="relative w-24 h-24 rounded-3xl bg-primary-500 flex items-center justify-center text-white shadow-lg">
                        <Rocket size={48} />
                      </div>
                    </div>
                    <div className="text-center space-y-2">
                      <h2 className="text-2xl font-bold tracking-tight">{t("welcome_ready")}</h2>
                      <p className="text-sm text-text-muted/80 max-w-sm leading-relaxed">
                        {t("welcome_desc")}
                      </p>
                    </div>
                    <Button 
                      size="lg" 
                      className="rounded-sm px-8 h-12 text-sm font-semibold tracking-wide"
                      onClick={() => void handleOpenProjectPicker()}
                    >
                      <Plus size={18} className="mr-2" />
                      {t("cmd_import_project")}
                    </Button>
                </div>
              ) : (
                <div className="h-full flex flex-col min-h-0 relative">
                  <AppHeader 
                    showSettings={showSettings} 
                    onToggleSettings={() => setShowSettings(!showSettings)} 
                  />

                  <div className="flex-1 min-h-0 bg-bg-base">
                    <Suspense fallback={<PanelFallback label="Workspace" />}>
                      <TaskWorkspace
                        projectPath={projectPath}
                        activeTask={activeTask || null}
                        onSetExecutionMode={handleSetExecutionMode}
                      />
                    </Suspense>
                  </div>
                </div>
              )}
            </Panel>

            {activeTask && taskFileChanges.length > 0 && (
              <>
                <Separator
                  className="w-px bg-border-muted/50 hover:bg-primary-500 active:bg-primary-600 transition-colors cursor-col-resize z-50 -mx-[0.5px]"
                />
                <Panel id="panel-right" defaultSize={260} minSize={200} maxSize={450} className="flex flex-col min-h-0 bg-transparent">
                  <GitChangesPanel 
                    gitChanges={taskFileChanges}
                    activeFile={activeFile}
                    onFileSelect={handleFileSelect}
                  />
                </Panel>
              </>
            )}
          </Group>
        )}
      </div>

      {/* Workspace Create Dialog */}
      <WorkspaceCreateDialog
        open={showCreateWorkspace}
        onClose={() => setShowCreateWorkspace(false)}
      />

      <DiffDialog
        open={diffOpen}
        onClose={() => setDiffOpen(false)}
        filePath={activeFile}
        diffContent={activeDiff}
      />
    </div>
  );
}
