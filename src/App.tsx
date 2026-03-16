import { Suspense, useMemo, useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "./stores/appStore";
import { useTranslation } from "./i18n";
import { useProject } from "./hooks/useProject";
import { useAppDragDrop } from "./hooks/useAppDragDrop";
import { useAppShortcuts } from "./hooks/useAppShortcuts";
import { AppProviders } from "./components/providers/AppProviders";
import { WorkspaceLayout } from "./components/layout/WorkspaceLayout";
import { CommandPalette } from "./components/CommandPalette";
import { ErrorBanner } from "./components/ErrorBanner";

function App() {
  const { t } = useTranslation();
  const { detectAndRecommend } = useProject();

  const {
    showSettings, setShowSettings,
    errorMessage: errorMessageStore, setErrorMessage: setErrorMessageStore,
  } = useAppStore(useShallow((s) => ({
    showSettings: s.showSettings,
    setShowSettings: s.setShowSettings,
    errorMessage: s.errorMessage,
    setErrorMessage: s.setErrorMessage,
  })));

  const [commandOpen, setCommandOpen] = useState(false);

  useEffect(() => {
    invoke("cli_reconcile_active_sessions").catch(console.error);
    invoke("pty_cleanup_dead_sessions").catch(console.error);
  }, []);

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
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: t("select_project_title"),
      });
      if (typeof selected === "string") {
        await handleImport(selected);
      }
    } catch (e) {
      const msg = String(e);
      if (!/user cancelled|canceled|aborted/i.test(msg)) {
        setErrorMessageStore(`${t("picker_error")}: ${msg}`);
      }
    }
  }, [handleImport, setErrorMessageStore, t]);

  useAppDragDrop({ onDropProject: handleImport });
  useAppShortcuts(commandOpen, setCommandOpen, showSettings, setShowSettings);

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

  return (
    <AppProviders>
      <div className="main-layout flex flex-col w-screen h-screen bg-bg-base overflow-hidden text-text-main">
        <Suspense fallback={null}>
          {commandOpen && (
            <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} actions={commandActions} />
          )}
        </Suspense>
        
        <ErrorBanner message={errorMessageStore} onClose={() => setErrorMessageStore(null)} />

        <WorkspaceLayout />
      </div>
    </AppProviders>
  );
}

export default App;
