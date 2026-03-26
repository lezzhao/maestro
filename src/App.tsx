import { Suspense, useMemo, useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "./stores/appStore";
import { useTranslation } from "./i18n";
import { useProject } from "./hooks/useProject";
import { useAppDragDrop } from "./hooks/useAppDragDrop";
import { useAppShortcuts } from "./hooks/useAppShortcuts";
import { useAgentStateSync } from "./hooks/useAgentStateSync";
import { AppProviders } from "./components/providers/AppProviders";
import { WorkspaceLayout } from "./components/layout/WorkspaceLayout";
import { CommandPalette } from "./components/CommandPalette";
import { Toaster, toast } from "sonner";

function App() {
  const { t } = useTranslation();
  const { detectAndRecommend } = useProject();

  const {
    showSettings, setShowSettings,
    theme
  } = useAppStore(useShallow((s) => ({
    showSettings: s.showSettings,
    setShowSettings: s.setShowSettings,
    theme: s.theme,
  })));

  const [commandOpen, setCommandOpen] = useState(false);

  const { projectPath } = useAppStore(useShallow((s) => ({
    projectPath: s.projectPath,
  })));

  useEffect(() => {
    invoke("cli_reconcile_active_sessions").catch(console.error);
    invoke("pty_cleanup_dead_sessions").catch(console.error);
    
    // Auto-sync backend project state if we have a persisted projectPath
    if (projectPath) {
      invoke("project_set_current", { projectPath }).catch(err => {
        console.error("Failed to sync project path:", err);
      });
    }
  }, [projectPath]);

  const handleImport = useCallback(
    async (path: string) => {
      try {
        const result = await detectAndRecommend(path);
        setShowSettings(false);
        toast.success("Project imported successfully");
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
      if (typeof selected === "string") {
        await handleImport(selected);
      }
    } catch (e) {
      const msg = String(e);
      if (!/user cancelled|canceled|aborted/i.test(msg)) {
        toast.error(`${t("picker_error")}: ${msg}`);
      }
    }
  }, [handleImport, t]);

  useAppDragDrop({ onDropProject: handleImport });
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
        run: () => void useAppStore.getState().addTask(""),
      }
    ],
    [handleOpenProjectPicker, setShowSettings, theme, t],
  );

  return (
    <AppProviders>
      <div className="main-layout flex flex-col w-screen h-screen bg-bg-base overflow-hidden text-text-main font-sans antialiased">
        <Toaster 
          position="top-center" 
          theme={theme === "system" ? "light" : theme}
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
      </div>
    </AppProviders>
  );
}

export default App;
