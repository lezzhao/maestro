import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useActiveTask } from "../../hooks/useActiveTask";
import { useAppStore } from "../../stores/appStore";
import { useChatStore } from "../../stores/chatStore";
import { useTranslation } from "../../i18n";
import {
  Monitor,
  Rocket,
  Plus,
} from "lucide-react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { Button } from "../ui/button";
import { Select } from "../ui/select";
import { cn } from "../../lib/utils";

import { SetupPanel } from "../SetupPanel";
import { TaskWorkspace } from "../TaskWorkspace";
import { MainSidebar } from "../MainSidebar";
import { ResourcePanel, type RightPanelTab } from "../ResourcePanel";
import { useEngine } from "../../hooks/useEngine";
import { useProject } from "../../hooks/useProject";
import { useAppLifecycle } from "../../hooks/useAppLifecycle";
import { useWorkspaceFlow } from "../../hooks/useWorkspaceFlow";
import { useTaskSwitchEffects } from "../../hooks/useTaskSwitchEffects";
import { PanelFallback } from "../ui/PanelFallback";

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
    upsertProfile,
    listModels,
  } = useEngine();
  const { projectPath, detectAndRecommend, gitStatus, gitDiff } = useProject();
  const { activeTaskId, activeTask } = useActiveTask();
  
  const activeEngineId = activeTask?.engineId || Object.keys(engines)[0] || "";
  const {
    showSettings, setShowSettings,
    setCurrentStep, setSidebarCollapsed,
    setErrorMessage: setErrorMessageStore,
    theme, setTheme,
    lang, setLang,
  } = useAppStore(useShallow((s) => ({
    showSettings: s.showSettings,
    setShowSettings: s.setShowSettings,
    setCurrentStep: s.setCurrentStep,
    setSidebarCollapsed: s.setSidebarCollapsed,
    setErrorMessage: s.setErrorMessage,
    theme: s.theme,
    setTheme: s.setTheme,
    lang: s.lang,
    setLang: s.setLang,
  })));

  const updateTask = useAppStore((s) => s.updateTask);
  const gitChanges = activeTask?.gitChanges || [];

  const [activeFile, setActiveFile] = useState<string>("");
  const [activeDiff, setActiveDiff] = useState<string>("");
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>("runs");
  const sidebarPanelRef = useRef<any>(null);

  const activeTaskMessages = useChatStore((s) => s.getTaskMessages(activeTaskId));
  const latestRun = useChatStore((s) => s.getLatestRun(activeTaskId));
  const latestVerification = useChatStore((s) => s.getRunVerification(latestRun?.id || null));

  const activeProfile = useMemo(() => {
    const engine = engines[activeEngineId];
    if (!engine?.profiles) return null;
    const profileId =
      engine.active_profile_id && engine.profiles[engine.active_profile_id]
        ? engine.active_profile_id
        : Object.keys(engine.profiles)[0];
    if (!profileId) return null;
    return engine.profiles[profileId] || null;
  }, [activeEngineId, engines]);
  
  const activeExecutionMode = ((activeProfile?.execution_mode || "cli") as "api" | "cli");

  useAppLifecycle(activeExecutionMode, activeEngineId);

  const { handleOpenProjectPicker } = useWorkspaceFlow({
    projectPath,
    showSettings,
    detectAndRecommend,
    setShowSettings,
    setCurrentStep,
    setErrorMessage: setErrorMessageStore,
  });

  const refreshGitStatus = useCallback(async (options?: { force?: boolean }) => {
    if (!projectPath || !activeTaskId) return;
    try {
      const status = await gitStatus(projectPath, options);
      updateTask(activeTaskId, { gitChanges: status });
    } catch (e) {
      const msg = String(e);
      updateTask(activeTaskId, { gitChanges: [] });
      if (!/不是 git 仓库|not a git repository/i.test(msg)) {
        setErrorMessageStore(`${t("read_git_status_fail")}: ${msg}`);
      }
    }
  }, [gitStatus, projectPath, activeTaskId, setErrorMessageStore, t, updateTask]);

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
          setErrorMessageStore(`${t("read_git_diff_fail")}: ${msg}`);
        }
      }
    },
    [gitDiff, projectPath, setErrorMessageStore, t],
  );

  const handleSwitchEngine = async (engineId: string) => {
    if (!engineId || engineId === activeEngineId) return;
    try {
      await switchEngine(engineId);
      setErrorMessageStore(null);
    } catch (e) {
      setErrorMessageStore(`${t("switch_engine_fail")}: ${String(e)}`);
    }
  };

  const handleSetExecutionMode = useCallback(
    async (mode: "api" | "cli") => {
      const engine = engines[activeEngineId];
      if (!engine?.profiles) return;
      const profileId =
        engine.active_profile_id && engine.profiles[engine.active_profile_id]
          ? engine.active_profile_id
          : Object.keys(engine.profiles)[0];
      if (!profileId) return;
      const profile = engine.profiles[profileId];
      if (!profile) return;
      if ((profile.execution_mode || "cli") === mode) return;
      await upsertProfile(activeEngineId, profileId, {
        ...profile,
        execution_mode: mode,
      });
    },
    [activeEngineId, engines, upsertProfile],
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

  const activePreflight = enginePreflight[activeEngineId];
  const isCliReady = Boolean(activePreflight?.command_exists) && Boolean(activePreflight?.auth_ok);
  const isApiReady = Boolean(activeProfile?.api_key && activeProfile?.api_base_url && activeProfile?.model);
  const isEngineReady = activeExecutionMode === "api" ? isApiReady : isCliReady;
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
  const projectName = useMemo(
    () =>
      projectPath
        ? projectPath.split("/").filter(Boolean).pop() || projectPath
        : t("none_selected"),
    [projectPath, t],
  );

  const trimmedProjectPath = projectPath?.trim();

  return (
    <div className="flex-1 h-full min-h-0 overflow-hidden relative">
      <Group 
        orientation="horizontal" 
        id="app-root-group" 
        className="w-full h-full"
      >
        <MainSidebar
          panelRef={sidebarPanelRef}
          projectName={projectName}
          onOpenSettings={() => setShowSettings(true)}
          onOpenProjectPicker={() => void handleOpenProjectPicker()}
        />

        <Separator
          className="w-2 bg-transparent hover:bg-primary-500/20 active:bg-primary-500/40 transition-colors cursor-col-resize flex items-center justify-center group relative z-50 -mx-1"
        >
          <div className="w-px h-full bg-border-muted/40 group-hover:bg-primary-500/50" />
          <div className="absolute top-1/2 -translate-y-1/2 w-1.5 h-12 bg-primary-500/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
        </Separator>

        <Panel id="panel-main" defaultSize={800} minSize={400} className="flex flex-col min-h-0 bg-bg-surface">
          {showSettings ? (
            <Suspense fallback={<PanelFallback label={t("nav_setup")} />}>
              <div className="h-full flex flex-col p-4 bg-bg-surface">
                 <div className="flex items-center justify-between mb-6 px-2">
                    <div className="flex flex-col">
                       <h2 className="text-xl font-black uppercase tracking-tighter">{t("nav_setup")}</h2>
                       <p className="text-[10px] text-text-muted/60 font-bold uppercase tracking-widest">Configuration & Credentials</p>
                    </div>
                    <Button variant="outline" size="sm" className="rounded-xl h-9" onClick={() => setShowSettings(false)}>
                       {t("back_to_workspace")}
                    </Button>
                 </div>
                 <div className="flex-1 overflow-y-auto custom-scrollbar rounded-2xl border border-border-muted bg-bg-base p-4 shadow-sm">
                     <SetupPanel
                       engines={engines}
                       enginePreflight={enginePreflight}
                       activeEngineId={activeEngineId}
                       onSwitch={handleSwitchEngine}
                       onPreflight={preflightEngine}
                       onPreflightAll={preflightAll}
                       onSaveEngine={upsertEngine}
                       onSetActiveProfile={setActiveProfile}
                       onUpsertProfile={upsertProfile}
                       onFetchModels={listModels}
                       theme={theme}
                       onThemeChange={setTheme}
                       lang={lang}
                       onLangChange={setLang}
                     />
                  </div>
              </div>
            </Suspense>
          ) : !trimmedProjectPath ? (
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
                  className="rounded-xl px-8 h-12 text-sm font-semibold tracking-wide"
                  onClick={() => void handleOpenProjectPicker()}
                >
                  <Plus size={18} className="mr-2" />
                  {t("cmd_import_project")}
                </Button>
            </div>
          ) : (
            <div className="h-full flex flex-col min-h-0 relative">
               <div className="h-14 border-b border-border-muted flex items-center justify-between px-4 bg-bg-surface z-10 shrink-0">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-bg-elevated rounded-lg border border-border-muted">
                      <div className={cn("h-1.5 w-1.5 rounded-full", isEngineReady ? "bg-emerald-500" : "bg-warning-500")} />
                      <span className="text-[10px] font-semibold text-text-muted">
                        {isEngineReady ? t("ready") : t("check_req")}
                      </span>
                    </div>
                    <div className="h-4 w-px bg-border-muted/30" />
                    <div className="w-[180px]">
                       <Select
                          value={selectedEngineValue}
                          options={availableEngineOptions}
                          onChange={(id) => void handleSwitchEngine(id)}
                          className="h-9 text-[11px] font-bold"
                          placeholder={availableEngineOptions.length > 0 ? t("engine_status") : "无可用 CLI"}
                        />
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                     <div className="text-right hidden sm:flex flex-col mr-1">
                        <span className="text-[9px] font-black text-text-muted opacity-40 uppercase tracking-widest leading-tight">Active Engine</span>
                        <span className="text-[11px] font-black text-primary-500 uppercase tracking-tighter leading-tight">{engines[activeEngineId]?.display_name || activeEngineId}</span>
                     </div>
                     <div className="h-8 w-8 rounded-full bg-primary-500/10 flex items-center justify-center text-primary-500 ring-4 ring-primary-500/5">
                        <Monitor size={14} />
                     </div>
                  </div>
               </div>

               <div className="flex-1 min-h-0 bg-bg-base">
                  <Suspense fallback={<PanelFallback label="Workspace" />}>
                    <TaskWorkspace
                      projectPath={projectPath}
                      engines={engines}
                      activeTask={activeTask || null}
                      onSetExecutionMode={handleSetExecutionMode}
                    />
                  </Suspense>
               </div>
            </div>
          )}
        </Panel>

        {activeTaskId && (
          <Separator
            className="w-2 bg-transparent hover:bg-primary-500/20 active:bg-primary-500/40 transition-colors cursor-col-resize flex items-center justify-center group relative z-50 -mx-1"
          >
            <div className="w-px h-full bg-border-muted/40 group-hover:bg-primary-500/50" />
          </Separator>
        )}
        {activeTaskId && (
          <ResourcePanel
            activeTaskId={activeTaskId}
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
        )}
      </Group>
    </div>
  );
}
