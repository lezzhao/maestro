import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useActiveTask } from "../../hooks/useActiveTask";
import { useAppUiState } from "../../hooks/use-app-store-selectors";
import { useTranslation } from "../../i18n";
import {
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
import { useTaskMessages } from "../../hooks/use-task-chat-state";
import { useTaskSwitchEffects } from "../../hooks/useTaskSwitchEffects";
import { useTaskRuntimeContext } from "../../hooks/useTaskRuntimeContext";
import { PanelFallback } from "../ui/PanelFallback";
import { toast } from "sonner";
import { parseTaskFileChanges } from "../../lib/fileChangeParser";
import { useAppStore } from "../../stores/appStore";
import { ArtifactsPanel } from "./ArtifactsPanel";
import { TaskChronicle } from "../TaskChronicle";


export function WorkspaceLayout() {
  const { t } = useTranslation();

  const {
    engines,
    enginePreflight,
    switchEngine,
    preflightEngine,
    preflightAll,
    setActiveProfile,
    updateTaskProfile,
    upsertProfile,
    listModels,
    upsertEngine,
    deleteEngine,
    onVerifyConnection,
  } = useEngine();
  const { projectPath, gitDiff } = useProject();
  const { activeTaskId, activeTask } = useActiveTask();
  const { 
    engineId: activeEngineId, 
    profileId: activeProfileId, 
    profile: activeProfile, 
    executionMode: activeExecutionMode, 
  } = useTaskRuntimeContext();
  const {
    showSettings, setShowSettings,
    setSidebarCollapsed,
    theme, setTheme,
    lang, setLang,
    activeWorkspaceId,
  } = useAppUiState();

  const { activeArtifact, isArtifactsPanelOpen } = useAppStore();

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

  const activeTaskMessages = useTaskMessages(activeTaskId);



  useAppLifecycle(activeExecutionMode, activeEngineId, activeTaskId);

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
    activeTaskMessagesLength: activeTaskMessages?.length || 0,
    setActiveFile,
    setActiveDiff,
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

  // 工作区列表已在 useAgentStateSync bootstrap 中加载，此处仅订阅 store
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
              onSetActiveProfile={handleSetActiveProfile}
              onUpsertProfile={upsertProfile}
              onFetchModels={listModels}
              onUpsertEngine={upsertEngine}
              onDeleteEngine={deleteEngine}
              onVerifyConnection={onVerifyConnection}
              theme={theme}
              onThemeChange={setTheme}
              lang={lang}
              onLangChange={setLang}
            />
          </Suspense>
        ) : !activeWorkspaceId ? (
          <div className="h-full flex flex-col items-center justify-center p-8 bg-bg-base/30 animate-in fade-in duration-500">
            <div className="w-[450px] space-y-8 flex flex-col items-center text-center">
              <div className="relative group">
                <div className="absolute inset-0 bg-primary blur-2xl opacity-20 rounded-full group-hover:opacity-30 transition-opacity" />
                <div className="relative w-24 h-24 rounded-2xl bg-bg-surface border border-border-muted flex items-center justify-center text-primary shadow-xl">
                  <Plus size={40} strokeWidth={2.5} />
                </div>
              </div>
              
              <div className="space-y-2">
                <h2 className="text-2xl font-black text-text-main tracking-tight uppercase">Ready to Start?</h2>
                <p className="text-sm text-text-muted/60 max-w-[320px] leading-relaxed mx-auto">
                  Create your first Workspace to begin coding with AI. Group your tasks and files into logical project environments.
                </p>
              </div>

              <Button 
                onClick={() => setShowCreateWorkspace(true)}
                size="lg"
                className="h-12 px-10 rounded-xl bg-primary hover:bg-primary/90 text-white font-black uppercase tracking-widest text-xs shadow-xl shadow-primary/20 hover:scale-105 transition-all"
              >
                Create New Workspace
              </Button>
            </div>
          </div>
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
              <div className="h-full flex flex-col min-h-0 relative">
                <AppHeader />

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
            </Panel>

            {activeTask && taskFileChanges.length > 0 && !activeArtifact && (
              <>
                <Separator
                  className="w-px bg-border-muted/50 hover:bg-primary-500 active:bg-primary-600 transition-colors cursor-col-resize z-50 -mx-[0.5px]"
                />
                <Panel id="panel-right" defaultSize={260} minSize={200} maxSize={450} className="flex flex-col min-h-0 bg-transparent p-2 gap-2">
                  <div className="flex-1 min-h-0">
                    <GitChangesPanel 
                      gitChanges={taskFileChanges}
                      activeFile={activeFile}
                      onFileSelect={handleFileSelect}
                    />
                  </div>
                  <div className="h-[250px] shrink-0">
                    <TaskChronicle messages={activeTaskMessages} />
                  </div>
                </Panel>
              </>
            )}

            {isArtifactsPanelOpen && activeArtifact && (
               <>
                <Separator
                  className="w-px bg-border-muted/50 hover:bg-primary-500 active:bg-primary-600 transition-colors cursor-col-resize z-50 -mx-[0.5px]"
                />
                <Panel id="panel-artifacts" defaultSize={500} minSize={300} className="flex flex-col min-h-0 bg-transparent">
                  <ArtifactsPanel />
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
