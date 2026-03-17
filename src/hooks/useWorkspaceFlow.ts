import { useCallback, useEffect } from "react";
import { useTranslation } from "../i18n";

type WorkspaceFlowParams = {
  projectPath: string;
  showSettings: boolean;
  detectAndRecommend: (path: string) => Promise<unknown>;
  setShowSettings: (show: boolean) => void;
  setCurrentStep: (step: "setup" | "project" | "compose" | "review") => void;
  setErrorMessage: (message: string | null) => void;
};

export function useWorkspaceFlow({
  projectPath,
  showSettings,
  detectAndRecommend,
  setShowSettings,
  setCurrentStep,
  setErrorMessage,
}: WorkspaceFlowParams) {
  const { t } = useTranslation();

  const handleImport = useCallback(
    async (path: string) => {
      try {
        const result = await detectAndRecommend(path);
        setShowSettings(false);
        setErrorMessage(null);
        return result;
      } catch (e) {
        setErrorMessage(`${t("import_fail")}: ${String(e)}`);
        throw e;
      }
    },
    [detectAndRecommend, setErrorMessage, setShowSettings, t],
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
        setErrorMessage(`${t("picker_error")}: ${msg}`);
      }
    }
  }, [handleImport, setErrorMessage, t]);

  useEffect(() => {
    if (showSettings) {
      setCurrentStep("setup");
    } else if (!projectPath) {
      setCurrentStep("project");
    } else {
      setCurrentStep("compose");
    }
  }, [projectPath, setCurrentStep, showSettings]);

  return {
    handleImport,
    handleOpenProjectPicker,
  };
}
