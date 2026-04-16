import { useCallback, useEffect } from "react";
import { useTranslation } from "../i18n";
import { toast } from "sonner";

type WorkspaceFlowParams = {
  projectPath: string;
  showSettings: boolean;
  detectAndRecommend: (path: string) => Promise<unknown>;
  setShowSettings: (show: boolean) => void;
  setCurrentStep: (step: "setup" | "project" | "compose" | "review") => void;
};

export function useWorkspaceFlow({
  projectPath,
  showSettings,
  detectAndRecommend,
  setShowSettings,
  setCurrentStep,
}: WorkspaceFlowParams) {
  const { t } = useTranslation();

  const handleImport = useCallback(
    async (path: string) => {
      try {
        const result = await detectAndRecommend(path);
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
