import { Rocket, Settings2, FolderTree, MessageSquare } from "lucide-react";
import { useTranslation } from "../../i18n";
import { cn } from "../../lib/utils";

interface ActivityBarProps {
  activeTab: "explorer" | "tasks";
  onTabChange: (tab: "explorer" | "tasks") => void;
  onOpenSettings: () => void;
  onOpenProjectPicker: () => void;
}

export function ActivityBar({
  activeTab,
  onTabChange,
  onOpenSettings,
  onOpenProjectPicker,
}: ActivityBarProps) {
  const { t } = useTranslation();

  return (
    <div className="w-12 h-full flex flex-col items-center py-3 bg-bg-surface border-r border-border-muted z-30 shrink-0">
      {/* Top Branding / Action */}
      <div 
        className="w-8 h-8 rounded-md bg-primary-500 flex items-center justify-center text-white mb-4 cursor-pointer hover:bg-primary-600 transition-colors"
        onClick={onOpenProjectPicker}
        title={t("cmd_import_project")}
      >
        <Rocket size={18} />
      </div>

      {/* Main Navigation */}
      <div className="flex flex-col gap-2 w-full px-2">
        <button
          onClick={() => onTabChange("tasks")}
          className={cn(
            "w-full aspect-square flex items-center justify-center rounded-md transition-all relative group",
            activeTab === "tasks" 
              ? "text-primary-500 bg-primary-500/10" 
              : "text-text-muted hover:text-text-main hover:bg-bg-elevated"
          )}
          title={t("active_tasks") || "Tasks"}
        >
          <MessageSquare size={20} className="stroke-[1.5px]" />
          {activeTab === "tasks" && (
            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-1/2 bg-primary-500 rounded-r-full" />
          )}
        </button>

        <button
          onClick={() => onTabChange("explorer")}
          className={cn(
            "w-full aspect-square flex items-center justify-center rounded-md transition-all relative group",
            activeTab === "explorer" 
              ? "text-primary-500 bg-primary-500/10" 
              : "text-text-muted hover:text-text-main hover:bg-bg-elevated"
          )}
          title="Explorer"
        >
          <FolderTree size={20} className="stroke-[1.5px]" />
          {activeTab === "explorer" && (
            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-1/2 bg-primary-500 rounded-r-full" />
          )}
        </button>
      </div>

      {/* Bottom Actions */}
      <div className="mt-auto flex flex-col gap-2 w-full px-2">
        <button
          onClick={onOpenSettings}
          className="w-full aspect-square flex items-center justify-center rounded-md text-text-muted hover:text-text-main hover:bg-bg-elevated transition-colors"
          title={t("nav_setup")}
        >
          <Settings2 size={20} className="stroke-[1.5px]" />
        </button>
      </div>
    </div>
  );
}
