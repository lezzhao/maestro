import { useState } from "react";
import { FolderOpen } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "./ui/button";
import { useTranslation } from "../i18n";

type Props = {
  projectPath: string;
  onApply: (path: string) => Promise<void>;
};

export function ProjectImport({ projectPath, onApply }: Props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [pickerError, setPickerError] = useState("");

  return (
    <div className="flex items-center gap-3 min-w-0">
      <Button
        variant="primary-gradient"
        size="lg"
        className="h-11 px-6 gap-2 shrink-0 font-bold shadow-glow"
        loading={loading}
        onClick={async () => {
          setLoading(true);
          setPickerError("");
          try {
            const selected = await open({
              directory: true,
              multiple: false,
              defaultPath: projectPath || undefined,
              title: t("select_project_title"),
            });
            const path = typeof selected === "string" ? selected : null;
            if (!path) return;
            await onApply(path);
          } catch (error) {
            const message =
              error instanceof Error ? error.message : t("picker_error");
            setPickerError(message);
          } finally {
            setLoading(false);
          }
        }}
      >
        {!loading && <FolderOpen size={18} />}
        {loading ? t("processing") : t("select_project")}
      </Button>
      
      <div className="flex flex-col min-w-0 overflow-hidden">
        <span className="text-[10px] text-text-muted uppercase font-bold tracking-widest leading-none mb-1">{t("target_project")}</span>
        <div
          className="text-xs font-mono text-text-muted truncate transition-colors hover:text-primary-500 cursor-default"
          title={projectPath || t("none_selected")}
        >
          {projectPath || t("none_selected_drag")}
        </div>
      </div>

      {pickerError && (
        <span className="text-[10px] font-bold text-rose-500 uppercase truncate" title={pickerError}>
          {t("error_header")}: {pickerError}
        </span>
      )}
    </div>
  );
}
