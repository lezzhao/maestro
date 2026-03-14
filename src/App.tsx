import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Toaster } from "./components/ui/sonner";
import { ErrorBanner } from "./components/ErrorBanner";
import { TaskSidebar } from "./components/TaskSidebar";
import { useEngine } from "./hooks/useEngine";
import { useProject } from "./hooks/useProject";
import { usePerformance } from "./hooks/usePerformance";
import { useTheme } from "./hooks/useTheme";
import { useAppStore } from "./stores/appStore";
import { useTranslation } from "./i18n";
import {
  Monitor,
  Settings2,
  Rocket,
  Plus,
  Loader2,
  ChevronRight,
} from "lucide-react";
import { Group, Panel, Separator, type PanelImperativeHandle } from "react-resizable-panels";
import { Button } from "./components/ui/button";
import { Select } from "./components/ui/select";
import { cn } from "./lib/utils";

import { SetupPanel } from "./components/SetupPanel";
import { ChatPanel } from "./components/ChatPanel";
import { CommandPalette } from "./components/CommandPalette";

import { GitChangesPanel } from "./components/GitChangesPanel";
import { ResourceStats } from "./components/ResourceStats";

function PanelFallback({ label }: { label: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex-1 min-h-0 flex flex-col items-center justify-center p-6 animate-pulse opacity-60">
      <div className="w-16 h-16 rounded-2xl bg-bg-elevated/80 flex items-center justify-center mb-6 shadow-inner">
        <Loader2 size={24} className="animate-spin text-primary-500/50" />
      </div>
      <div className="text-xs font-black tracking-widest uppercase text-text-muted/60 mb-2">
        {t("loading")} {label}
      </div>
    </div>
  );
}

function runWhenIdle(task: () => void, timeout = 1200) {
  const win = window as Window & {
    requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number;
    cancelIdleCallback?: (idleId: number) => void;
  };
  if (typeof win.requestIdleCallback === "function") {
    const id = win.requestIdleCallback(task, { timeout });
    return () => win.cancelIdleCallback?.(id);
  }
  const timer = window.setTimeout(task, 180);
  return () => window.clearTimeout(timer);
}

function App() {
  console.log("[App] Body Render Start.");

  useTheme();
  usePerformance();
  const { t } = useTranslation();

  const {
    engines,
    enginePreflight,
    activeEngineId,
    switchEngine,
    preflightEngine,
    preflightAll,
    upsertEngine,
    setActiveProfile,
    upsertProfile,
    listModels,
  } = useEngine();
  const { projectPath, detectAndRecommend, gitStatus, gitDiff } = useProject();

  const setCurrentStep = useAppStore((s) => s.setCurrentStep);
  const showSettings = useAppStore((s) => s.showSettings);
  const setShowSettings = useAppStore((s) => s.setShowSettings);
  const setSidebarCollapsed = useAppStore((s) => s.setSidebarCollapsed);
  
  const tasks = useAppStore((s) => s.tasks);
  const activeTaskId = useAppStore((s) => s.activeTaskId);
  const updateActiveTask = useAppStore((s) => s.updateActiveTask);

  console.log("[App] Body Render Start. tasks:", tasks.length, "activeTaskId:", activeTaskId);
  const activeTask = useMemo(() => tasks.find((t) => t.id === activeTaskId), [tasks, activeTaskId]);
  const gitChanges = activeTask?.gitChanges || [];

  const errorMessageStore = useAppStore((s) => s.errorMessage);
  const setErrorMessageStore = useAppStore((s) => s.setErrorMessage);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const lang = useAppStore((s) => s.lang);
  const setLang = useAppStore((s) => s.setLang);

  const [commandOpen, setCommandOpen] = useState(false);
  const [activeFile, setActiveFile] = useState<string>("");

  const sidebarPanelRef = useRef<PanelImperativeHandle | null>(null);
  const bootPreflightStartedRef = useRef(false);
  const autoSelectDoneRef = useRef(false);
  const autoSelectingRef = useRef(false);

  const handleImport = useCallback(
    async (path: string) => {
      try {
        const result = await detectAndRecommend(path);
        setShowSettings(false);
        setErrorMessageStore(null);
        return result;
      } catch (e) {
        setErrorMessageStore(`${t("import_fail")}: ${String(e)}`);
        throw e;
      }
    },
    [detectAndRecommend, setErrorMessageStore, setShowSettings, t],
  );

  const handleOpenProjectPicker = useCallback(async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      directory: true,
      multiple: false,
      title: t("select_project_title"),
    });
    if (typeof selected === "string") {
      await handleImport(selected);
    }
  }, [handleImport, t]);

  const refreshGitStatus = useCallback(async (options?: { force?: boolean }) => {
    if (!projectPath || !activeTaskId) return;
    try {
      const status = await gitStatus(projectPath, options);
      updateActiveTask({ gitChanges: status });
    } catch (e) {
      const msg = String(e);
      updateActiveTask({ gitChanges: [] });
      if (!/不是 git 仓库|not a git repository/i.test(msg)) {
        setErrorMessageStore(`${t("read_git_status_fail")}: ${msg}`);
      }
    }
  }, [gitStatus, projectPath, activeTaskId, updateActiveTask, setErrorMessageStore, t]);

  const loadGitDiff = useCallback(
    async (filePath?: string, options?: { force?: boolean }) => {
      if (!projectPath) return;
      try {
        await gitDiff(filePath, projectPath, options);
      } catch (e) {
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

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void (async () => {
      unlisten = await getCurrentWindow().onDragDropEvent(async (event) => {
        if (event.payload.type === "drop" && event.payload.paths.length > 0) {
          const path = event.payload.paths[0];
          try {
            await handleImport(path);
          } catch (e) {
            setErrorMessageStore(`${t("drag_drop_fail")}: ${String(e)}`);
          }
        }
      });
    })();
    return () => unlisten?.();
  }, [handleImport, setErrorMessageStore, t]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (bootPreflightStartedRef.current) return;
    if (Object.keys(engines).length === 0) return;
    bootPreflightStartedRef.current = true;
    const cancel = runWhenIdle(() => {
      void preflightAll();
    });
    return cancel;
  }, [engines, preflightAll]);

  useEffect(() => {
    if (autoSelectDoneRef.current || Object.keys(engines).length === 0) return;
    const readyEngineId = Object.entries(enginePreflight).find(
      ([, value]) => value.command_exists && value.auth_ok,
    )?.[0];
    if (readyEngineId) {
      if (readyEngineId === activeEngineId) {
        autoSelectDoneRef.current = true;
        return;
      }
      if (!autoSelectingRef.current) {
        autoSelectingRef.current = true;
        void switchEngine(readyEngineId).finally(() => {
          autoSelectingRef.current = false;
          autoSelectDoneRef.current = true;
        });
      }
      return;
    }
    const checked = Object.keys(enginePreflight).length;
    if (checked >= Object.keys(engines).length) {
      autoSelectDoneRef.current = true;
    }
  }, [activeEngineId, enginePreflight, engines, switchEngine]);

  useEffect(() => {
    if (showSettings) {
      setCurrentStep("setup");
    } else if (!projectPath) {
      setCurrentStep("project");
    } else {
      setCurrentStep("compose");
    }
  }, [projectPath, setCurrentStep, showSettings]);

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
  const availableEngineOptions = useMemo(
    () =>
      Object.entries(engines)
        .filter(([id]) => {
          const pf = enginePreflight[id];
          return Boolean(pf?.command_exists) && Boolean(pf?.auth_ok);
        })
        .map(([id, engine]) => ({
          value: id,
          label: engine.display_name || id,
        })),
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

  const commandActions = useMemo(
    () => [
      {
        id: "project.import",
        title: t("cmd_import_project"),
        subtitle: t("cmd_import_project_sub"),
        keywords: "import open project folder",
        run: () => void handleOpenProjectPicker(),
      },
      {
        id: "ui.settings",
        title: t("cmd_open_settings"),
        subtitle: t("cmd_open_settings_sub"),
        keywords: "setup settings engine model",
        run: () => setShowSettings(true),
      },
      {
        id: "task.new",
        title: t("cmd_new_task") || "New Task",
        subtitle: t("cmd_new_task_sub") || "Create a parallel workspace",
        keywords: "task context new parallel",
        run: () => useAppStore.getState().addTask(""),
      }
    ],
    [handleOpenProjectPicker, setShowSettings, t],
  );

  const trimmedProjectPath = projectPath?.trim();

  return (
    <div className="main-layout flex flex-col w-screen h-screen bg-bg-base overflow-hidden text-text-main">
      <Suspense fallback={null}>
        {commandOpen && (
          <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} actions={commandActions} />
        )}
      </Suspense>
      
      {/* Global Overlays */}
      <Toaster position="top-center" expand={false} richColors closeButton />
      <ErrorBanner message={errorMessageStore} onClose={() => setErrorMessageStore(null)} />

      <div className="flex-1 h-full min-h-0 overflow-hidden relative">
        <Group 
          orientation="horizontal" 
          id="app-root-group" 
          className="w-full h-full"
        >
          <Panel
            id="panel-sidebar"
            panelRef={sidebarPanelRef}
            defaultSize={260}
            minSize={200}
            maxSize={450}
            className="flex flex-col border-r border-border-muted/30 bg-bg-surface overflow-hidden relative z-20"
          >
            {/* Sidebar Header */}
            <div className="p-4 space-y-4">
              <div 
                className="flex items-center gap-2.5 group cursor-pointer"
                onClick={() => setShowSettings(true)}
              >
                <div className="w-8 h-8 rounded-lg bg-primary-500 flex items-center justify-center text-white transition-all group-active:scale-95">
                  <Rocket size={16} />
                </div>
                <div className="flex flex-col">
                  <h1 className="text-[14px] font-bold leading-none">
                    BMAD <span className="text-primary-500">Client</span>
                  </h1>
                  <span className="text-[10px] font-medium text-text-muted/60">
                    v0.1.0
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <div 
                  className="flex items-center justify-between px-3 py-2 bg-bg-elevated/40 rounded-xl border border-border-muted/30 group cursor-pointer hover:border-primary-500/30 transition-colors"
                  onClick={() => void handleOpenProjectPicker()}
                >
                  <div className="flex flex-col min-w-0">
                    <span className="text-[10px] font-semibold text-text-muted/60">{t("active_project")}</span>
                    <span className="text-xs font-bold truncate text-text-main pr-2">{projectName}</span>
                  </div>
                  <div className="shrink-0 w-6 h-6 rounded-md bg-bg-subtle flex items-center justify-center text-text-muted group-hover:text-primary-500 transition-colors">
                    <Plus size={14} />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex-1 min-h-0 px-2 overflow-hidden">
               <TaskSidebar />
            </div>

            {/* Sidebar Footer */}
            <div className="p-3 mt-auto space-y-2 border-t border-border-muted/20 bg-bg-elevated/10">
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start gap-3 h-10 text-text-muted hover:text-text-main hover:bg-bg-elevated border border-transparent rounded-lg px-3 transition-all"
                onClick={() => setShowSettings(true)}
              >
                <Settings2 size={16} />
                <span className="text-xs font-semibold">{t("nav_setup")}</span>
                <div className="ml-auto opacity-40">
                  <ChevronRight size={12} />
                </div>
              </Button>
            </div>
          </Panel>

          <Separator
            className="w-2 bg-transparent hover:bg-primary-500/20 active:bg-primary-500/40 transition-colors cursor-col-resize flex items-center justify-center group relative z-50 -mx-1"
          >
            <div className="w-px h-full bg-border-muted/40 group-hover:bg-primary-500/50" />
            <div className="absolute top-1/2 -translate-y-1/2 w-1.5 h-12 bg-primary-500/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
          </Separator>

          <Panel id="panel-main" defaultSize={800} minSize={400} className="flex flex-col min-h-0 bg-bg-base">
            {showSettings ? (
              <Suspense fallback={<PanelFallback label={t("nav_setup")} />}>
                <div className="h-full flex flex-col p-4 bg-bg-surface/20">
                   <div className="flex items-center justify-between mb-6 px-2">
                      <div className="flex flex-col">
                         <h2 className="text-xl font-black uppercase tracking-tighter">{t("nav_setup")}</h2>
                         <p className="text-[10px] text-text-muted/60 font-bold uppercase tracking-widest">Configuration & Credentials</p>
                      </div>
                      <Button variant="outline" size="sm" className="rounded-xl h-9" onClick={() => setShowSettings(false)}>
                         {t("back_to_workspace")}
                      </Button>
                   </div>
                   <div className="flex-1 overflow-y-auto custom-scrollbar rounded-2xl border border-border-muted/30 bg-bg-surface/50 p-4 shadow-sm">
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
                 {/* Middle Panel Header */}
                 <div className="h-14 border-b border-border-muted/30 flex items-center justify-between px-4 bg-bg-surface/40 backdrop-blur-md z-10 shrink-0">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2 px-3 py-1.5 bg-bg-elevated rounded-lg border border-border-muted">
                        <div className={cn("h-1.5 w-1.5 rounded-full", isCliReady ? "bg-emerald-500" : "bg-warning-500")} />
                        <span className="text-[10px] font-semibold text-text-muted">
                          {isCliReady ? t("ready") : t("check_req")}
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

                 <div className="flex-1 min-h-0 bg-bg-base/20">
                    <Suspense fallback={<PanelFallback label="Chat" />}>
                      <ChatPanel
                        projectPath={projectPath}
                        engines={engines}
                        activeEngineId={activeEngineId}
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
            <Panel id="resource-panel" defaultSize={320} minSize={200} className="flex flex-col gap-2 p-2 bg-bg-elevated/5">
              <div className="flex-1 min-h-0">
                <GitChangesPanel 
                  gitChanges={gitChanges}
                  activeFile={activeFile}
                  onFileSelect={(path) => {
                    setActiveFile(path);
                    void loadGitDiff(path);
                  }}
                  onRefresh={() => refreshGitStatus({ force: true })}
                />
              </div>
              <div className="h-[210px] shrink-0">
                <ResourceStats />
              </div>
            </Panel>
          )}
        </Group>
      </div>
    </div>
  );
}

export default App;
