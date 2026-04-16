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
import { SkillGallery } from "../SkillGallery";


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
    showSkillGallery, setShowSkillGallery,
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
    <div className="flex-1 h-full min-h-0 overflow-hidden relative flex bg-background/95 text-foreground font-sans">

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
        ) : showSkillGallery ? (
          <Suspense fallback={null}>
            <SkillGallery />
          </Suspense>
        ) : !activeWorkspaceId ? (
          <div className="h-full flex flex-col items-center justify-center p-8 bg-background relative overflow-hidden animate-in fade-in duration-1000">
            {/* Ambient Background Glow */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/5 blur-[120px] rounded-full pointer-events-none" />
            
            <div className="w-[480px] space-y-12 flex flex-col items-center text-center relative z-10">
              <div className="relative group">
                <div className="absolute inset-0 bg-primary/20 blur-3xl rounded-full group-hover:bg-primary/40 transition-all duration-1000 opacity-50" />
                <div className="relative w-32 h-32 rounded-[2.5rem] bg-glass-surface-strong border border-white/[0.05] shadow-2xl flex items-center justify-center text-primary transform group-hover:scale-110 group-hover:rotate-3 transition-all duration-700 inner-border">
                  <Plus size={48} strokeWidth={1.5} className="group-hover:rotate-90 transition-transform duration-500" />
                </div>
              </div>
              
              <div className="space-y-4">
                <h2 className="text-4xl font-black text-foreground tracking-tighter uppercase">Initiate Workspace</h2>
                <p className="text-[14px] font-bold text-muted-foreground/40 max-w-[340px] leading-relaxed mx-auto tracking-tight uppercase">
                  Encapsulate your logic.
                  <br />
                  Define your boundary.
                </p>
              </div>

              <button 
                onClick={() => setShowCreateWorkspace(true)}
                className="h-14 px-12 rounded-2xl bg-primary text-primary-foreground font-black uppercase tracking-[0.2em] text-[11px] shadow-2xl shadow-primary/20 hover:scale-[1.05] active:scale-[0.95] transition-all duration-500 inner-border"
              >
                Create First Workspace
              </button>
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
              onOpenSettings={() => setShowSettings(true)}
              onCreateWorkspace={() => setShowCreateWorkspace(true)}
            />

            <Separator
              className="w-px bg-white/[0.04] dark:bg-white/[0.02] hover:bg-primary/40 transition-colors cursor-col-resize z-sidebar -mx-[0.5px]"
            />

            <Panel id="panel-main" defaultSize={800} minSize={400} className="flex flex-col min-h-0 bg-background relative z-main-content overflow-visible">
              <div className="h-full flex flex-col min-h-0 relative">
                <AppHeader />

                <div className="flex-1 min-h-0">
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
                  className="w-px bg-border/40 hover:bg-primary/50 transition-colors cursor-col-resize z-dropdown -mx-[0.5px]"
                />
                <Panel id="panel-right" defaultSize={260} minSize={200} maxSize={450} className="flex flex-col min-h-0 bg-card p-2 gap-2 border-l border-border/40">
                  <div className="flex-1 min-h-0">
                    <GitChangesPanel 
                      gitChanges={taskFileChanges}
                      activeFile={activeFile}
                      onFileSelect={handleFileSelect}
                    />
                  </div>
                  <div className="h-[250px] shrink-0 border-t border-border/40 pt-2">
                    <TaskChronicle messages={activeTaskMessages} />
                  </div>
                </Panel>
              </>
            )}

            {isArtifactsPanelOpen && activeArtifact && (
               <>
                <Separator
                  className="w-px bg-border/40 hover:bg-primary/50 transition-colors cursor-col-resize z-dropdown -mx-[0.5px]"
                />
                <Panel id="panel-artifacts" defaultSize={500} minSize={300} className="flex flex-col min-h-0 bg-card border-l border-border/40">
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
