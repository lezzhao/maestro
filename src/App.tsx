import { Suspense, useMemo, useState, useCallback, useEffect } from "react";
import { useAppStore } from "./stores/appStore";
import { useTranslation } from "./i18n";
import {
  useActiveWorkspace,
  useAppUiState,
  useProjectStoreState,
  useWorkspaceStoreState,
} from "./hooks/use-app-store-selectors";
import { useProject } from "./hooks/useProject";
import { useAppDragDrop } from "./hooks/useAppDragDrop";
import { useAppShortcuts } from "./hooks/useAppShortcuts";
import { useAgentStateSync } from "./hooks/useAgentStateSync";
import { AppProviders } from "./components/providers/AppProviders";
import { WorkspaceLayout } from "./components/layout/WorkspaceLayout";
import { CommandPalette } from "./components/CommandPalette";
import { Toaster, toast } from "sonner";
import {
  cleanupDeadPtySessionsCommand,
  reconcileActiveCliSessionsCommand,
} from "./hooks/commands/app-runtime-commands";
import { setCurrentProjectCommand } from "./hooks/commands/project-commands";
import { updateWorkspaceCommand } from "./hooks/commands/workspace-commands";
import { PermissionDialog } from "./components/chat/PermissionDialog";
import { useTaskActions } from "./hooks/useTaskActions";
import { Z_INDEX } from "./constants";
import { JiavisHUD } from "./components/chat/JiavisHUD";
import { getCurrentWindow } from "@tauri-apps/api/window";

function App() {
  const { t } = useTranslation();
  const { detectAndRecommend } = useProject();
  const { showSettings, setShowSettings, theme } = useAppUiState();
  const { activeWorkspaceId, workspaces } = useWorkspaceStoreState();
  const { setProjectPath } = useProjectStoreState();
  const activeWorkspace = useActiveWorkspace();
  const { handleAddTask } = useTaskActions();

  const [commandOpen, setCommandOpen] = useState(false);
  const [windowLabel, setWindowLabel] = useState<string | null>(null);

  useEffect(() => {
    setWindowLabel(getCurrentWindow().label);
  }, []);
// ... (lines 36-160 skipped for brevity in targetContent but I'll include them in ReplacementContent if needed, actually I'll just use a smaller chunk)

  useEffect(() => {
    const initSession = async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("ui_session_init");
    };
    const destroySession = async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("ui_session_destroy");
    };

    void initSession();
    return () => {
      void destroySession();
    };
  }, []);

  useEffect(() => {
    reconcileActiveCliSessionsCommand().catch(console.error);
    cleanupDeadPtySessionsCommand().catch(console.error);
  }, []);

  useEffect(() => {
    if (activeWorkspaceId && workspaces.length === 0) return;

    const nextProjectPath = activeWorkspace?.workingDirectory?.trim() || "";

    const syncWorkspaceProject = async () => {
      try {
        await setCurrentProjectCommand(nextProjectPath);
        setProjectPath(nextProjectPath);
      } catch (error) {
        console.error("Failed to sync workspace project path:", error);
        setProjectPath("");
        await setCurrentProjectCommand("").catch(() => undefined);
        if (nextProjectPath) {
          toast.error(`工作区目录不可用: ${String(error)}`);
        }
      }
    };

    void syncWorkspaceProject();
  }, [activeWorkspace, activeWorkspaceId, setProjectPath, workspaces.length]);

  const handleImport = useCallback(
    async (path: string) => {
      try {
        const result = await detectAndRecommend(path);
        const currentWorkspaceId = useAppStore.getState().activeWorkspaceId;
        if (currentWorkspaceId) {
          await updateWorkspaceCommand({
            id: currentWorkspaceId,
            workingDirectory: path,
          });
          useAppStore.getState().updateWorkspace(currentWorkspaceId, {
            workingDirectory: path,
          });
        }
        setShowSettings(false);
        return result;
      } catch (e) {
        const msg = String(e);
        if (msg.includes("Workspace Trust Required")) {
          toast.warning("Workspace Trust Required", {
            description: "Cursor Agent requires directory trust. Please run 'cursor agent' in your terminal once.",
            duration: 6000,
            action: {
              label: "How to fix",
              onClick: () => window.open("https://docs.cursor.com/agent/trust", "_blank")
            }
          });
        } else {
          toast.error(`${t("import_fail")}: ${msg}`);
        }
        throw e;
      }
    },
    [detectAndRecommend, setShowSettings, t],
  );

  const handleOpenProjectPicker = useCallback(async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: t("select_project_title"),
      });
      const newPath = Array.isArray(selected) ? selected[0] : (selected as string);
      if (!newPath) return;
      await handleImport(newPath);
    } catch (e) {
      const msg = String(e);
      if (!/user cancelled|canceled|aborted/i.test(msg)) {
        toast.error(`${t("picker_error")}: ${msg}`);
      }
    }
  }, [handleImport, t]);

  useAppDragDrop({ onDropProject: handleImport });
  
  useEffect(() => {
    const handlePickerEvent = () => void handleOpenProjectPicker();
    window.addEventListener("maestro:open-project-picker", handlePickerEvent);
    return () => window.removeEventListener("maestro:open-project-picker", handlePickerEvent);
  }, [handleOpenProjectPicker]);

  useAppShortcuts(commandOpen, setCommandOpen, showSettings, setShowSettings);
  useAgentStateSync();

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
        id: "ui.theme",
        title: t("cmd_toggle_theme"),
        subtitle: t("cmd_toggle_theme_sub"),
        keywords: "theme dark light system mode",
        run: () => {
          const themes: ("light" | "dark" | "system")[] = ["light", "dark", "system"];
          const next = themes[(themes.indexOf(theme) + 1) % themes.length];
          useAppStore.getState().setTheme(next);
        },
      },
      {
        id: "ui.lang",
        title: t("cmd_switch_lang"),
        subtitle: t("cmd_switch_lang_sub"),
        keywords: "language translation chinese english zh en",
        run: () => {
          const current = useAppStore.getState().lang;
          useAppStore.getState().setLang(current === "zh" ? "en" : "zh");
        },
      },
      {
        id: "task.new",
        title: t("cmd_new_task") || "New Task",
        subtitle: t("cmd_new_task_sub") || "Create a parallel workspace",
        keywords: "task context new parallel",
        run: () => void handleAddTask(""),
      }
    ],
    [handleOpenProjectPicker, setShowSettings, theme, t, handleAddTask],
  );

  if (windowLabel === "jiavis") {
    return <JiavisHUD />;
  }

  return (
    <AppProviders>
      <div className="main-layout flex flex-col w-screen h-screen bg-bg-base overflow-hidden text-text-main font-sans antialiased">
        <Toaster 
          position="top-center" 
          theme={theme === "system" ? "light" : theme}
          style={{ zIndex: Z_INDEX.TOAST }}
          toastOptions={{
            style: {
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-muted)',
              boxShadow: 'var(--shadow-md)',
              color: 'var(--text-main)',
              fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
            },
          }}
        />
        
        <Suspense fallback={null}>
          {commandOpen && (
            <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} actions={commandActions} />
          )}
        </Suspense>
        
        <WorkspaceLayout />
        <PermissionDialog />
      </div>
    </AppProviders>
  );
}

export default App;
