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
  Zap,
} from "lucide-react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { Button } from "../ui/button";
import { Select } from "../ui/select";
import { cn } from "../../lib/utils";

import { SettingsView } from "../setup/SettingsView";
import { TaskWorkspace } from "../TaskWorkspace";
import { MainSidebar } from "../MainSidebar";
import { ActivityBar } from "./ActivityBar";
import { ResourcePanel, type RightPanelTab } from "../ResourcePanel";
import { WorkspaceCreateDialog } from "../WorkspaceCreateDialog";
import { useEngine } from "../../hooks/useEngine";
import { useProject } from "../../hooks/useProject";
import { useAppLifecycle } from "../../hooks/useAppLifecycle";
import { useWorkspaceFlow } from "../../hooks/useWorkspaceFlow";
import { useTaskSwitchEffects } from "../../hooks/useTaskSwitchEffects";
import { useTaskRuntimeContext } from "../../hooks/useTaskRuntimeContext";
import { PanelFallback } from "../ui/PanelFallback";
import { toast } from "sonner";
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
  const { projectPath, detectAndRecommend, gitStatus, gitDiff } = useProject();
  const { activeTaskId, activeTask } = useActiveTask();
  const { 
    engineId: activeEngineId, 
    profileId: activeProfileId, 
    profile: activeProfile, 
    executionMode: activeExecutionMode, 
    isReady: isEngineReady 
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

  const updateTaskRecord = useAppStore((s) => s.updateTaskRecord);
  const gitChanges = activeTask?.gitChanges || [];

  const [activeFile, setActiveFile] = useState<string>("");
  const [activeDiff, setActiveDiff] = useState<string>("");
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>("runs");
  const [showCreateWorkspace, setShowCreateWorkspace] = useState(false);
  const sidebarPanelRef = useRef<import("react-resizable-panels").PanelImperativeHandle>(null);

  const activeTaskMessages = useChatStore((s) => s.getTaskMessages(activeTaskId));
  const latestRun = useChatStore((s) => s.getLatestRun(activeTaskId));
  const latestVerification = useChatStore((s) => s.getRunVerification(latestRun?.id || null));

  const totalTokens = useMemo(() => {
    let input = 0;
    let output = 0;
    activeTaskMessages.forEach((m) => {
      if (m.tokenEstimate) {
        input += m.tokenEstimate.approx_input_tokens || 0;
        output += m.tokenEstimate.approx_output_tokens || 0;
      }
    });
    return { input, output, total: input + output };
  }, [activeTaskMessages]);

  const profileId = activeProfileId;

  useAppLifecycle(activeExecutionMode, activeEngineId);

  const { handleOpenProjectPicker } = useWorkspaceFlow({
    projectPath,
    showSettings,
    detectAndRecommend,
    setShowSettings,
    setCurrentStep,
  });

  const refreshGitStatus = useCallback(async (options?: { force?: boolean }) => {
    if (!projectPath || !activeTaskId) return;
    try {
      const status = await gitStatus(projectPath, options);
      updateTaskRecord(activeTaskId, { gitChanges: status });
    } catch (e) {
      const msg = String(e);
      updateTaskRecord(activeTaskId, { gitChanges: [] });
      if (!/不是 git 仓库|not a git repository/i.test(msg)) {
        toast.error(`${t("read_git_status_fail")}: ${msg}`);
      }
    }
  }, [gitStatus, projectPath, activeTaskId, t, updateTaskRecord]);

  const loadGitDiff = useCallback(
    async (filePath?: string, options?: { force?: boolean }) => {
      if (!projectPath) return;
      try {
        const diff = await gitDiff(filePath, projectPath, options);
        setActiveDiff(diff);
      } catch (e) {
        setActiveDiff("");
        const msg = String(e);
        if (!/不是 git 仓库|not a git repository/i.test(msg)) {
          toast.error(`${t("read_git_diff_fail")}: ${msg}`);
        }
      }
    },
    [gitDiff, projectPath, t],
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
    projectPath,
    latestRunId: latestRun?.id,
    latestRunStatus: latestRun?.status,
    setActiveFile,
    setActiveDiff,
    refreshGitStatus,
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

  const availableEngineOptions = useMemo(
    () =>
      Object.entries(engines)
        .map(([id, engine]) => {
          const pf = enginePreflight[id];
          const cliReady = Boolean(pf?.command_exists) && Boolean(pf?.auth_ok);
          const suffix = cliReady ? "" : "（CLI未就绪）";
          return {
          value: id,
          label: `${engine.display_name || id}${suffix}`,
          };
        }),
    [enginePreflight, engines],
  );
  const selectedEngineValue = useMemo(() => {
    if (availableEngineOptions.some((opt) => opt.value === activeEngineId)) return activeEngineId;
    return availableEngineOptions[0]?.value || "";
  }, [activeEngineId, availableEngineOptions]);


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
                  <div className="h-16 flex items-center justify-between px-8 bg-bg-surface/50 backdrop-blur-md z-10 shrink-0 border-b border-border-muted/5">
                    <div className="flex items-center gap-6">
                      <div className="flex items-center gap-3 px-4 py-2 bg-bg-base rounded-full border border-border-muted/20 shadow-sm transition-all hover:border-primary-500/30">
                        <div className={cn("h-2 w-2 rounded-full", isEngineReady ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-warning-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]")} />
                        <span className="text-xs font-bold text-text-muted tracking-wide">
                          {isEngineReady ? t("ready") : t("check_req")}
                        </span>
                      </div>
                      <div className="h-6 w-px bg-border-muted/10" />
                      <div className="w-[180px] group relative">
                        <Select
                            value={selectedEngineValue}
                            options={availableEngineOptions}
                            onChange={(id) => void handleSwitchEngine(id)}
                            className="h-10 text-xs font-bold border-transparent hover:border-primary-500/20 bg-transparent transition-all"
                            placeholder={availableEngineOptions.length > 0 ? t("engine_status") : "无可用 CLI"}
                          />
                      </div>
                      {activeTaskId && (
                        <>
                          <div className="h-6 w-px bg-border-muted/10" />
                          
                          {/* Token usage info */}
                          <div className="flex items-center gap-3 px-4 py-2 bg-bg-base/40 rounded-full border border-border-muted/10">
                            <div className="flex flex-col">
                              <span className="text-[10px] text-text-muted/40 uppercase font-bold tracking-widest leading-none mb-1">Tokens</span>
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-black text-text-main leading-none">
                                  {totalTokens.total.toLocaleString()}
                                </span>
                                <div className="flex items-center gap-1.5 opacity-60">
                                  <span className="text-[9px] text-emerald-500 font-bold">IN {totalTokens.input.toLocaleString()}</span>
                                  <span className="text-[9px] text-blue-500 font-bold">OUT {totalTokens.output.toLocaleString()}</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </>
                      )}
                    </div>

                    <div className="flex items-center gap-4">
                      {activeProfile && (
                        <div className="text-right hidden sm:flex flex-col mr-2">
                           <span className="text-[10px] font-bold text-text-muted/30 uppercase tracking-[0.2em] leading-tight">
                             {activeProfile.model || "Unknown Model"}
                           </span>
                           <span className="text-xs font-black text-primary-500/80 uppercase tracking-tight leading-tight">
                             {activeProfile.display_name || profileId}
                           </span>
                        </div>
                      )}
                      <div className="h-10 w-10 rounded-xl bg-primary-500/5 flex items-center justify-center text-primary-500 border border-primary-500/10 shadow-glow active:scale-95 transition-all">
                          <Zap size={18} />
                      </div>
                    </div>
                  </div>

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

            {/* Column 4: Right Panel - only show if task is active */}
            {activeTask && (
              <>
                <Separator
                  className="w-px bg-border-muted/50 hover:bg-primary-500 active:bg-primary-600 transition-colors cursor-col-resize z-50 -mx-[0.5px]"
                />
                <ResourcePanel
                  activeTaskId={activeTask.id}
                  activeEngineId={activeEngineId}
                  rightPanelTab={rightPanelTab}
                  setRightPanelTab={setRightPanelTab}
                  gitChanges={gitChanges}
                  activeFile={activeFile}
                  activeDiff={activeDiff}
                  onFileSelect={(path) => {
                    setActiveFile(path);
                    void loadGitDiff(path);
                  }}
                  onRefreshGit={() => refreshGitStatus({ force: true })}
                  latestVerification={latestVerification || null}
                  latestRun={latestRun || null}
                  activeTaskMessages={activeTaskMessages}
                />
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
    </div>
  );
}
