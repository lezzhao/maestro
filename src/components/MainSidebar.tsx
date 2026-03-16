import { Rocket, Plus, Settings2, ChevronRight } from "lucide-react";
import { Panel, type PanelImperativeHandle } from "react-resizable-panels";
import { Button } from "./ui/button";
import { TaskSidebar } from "./TaskSidebar";
import { useTranslation } from "../i18n";
import type { RefObject } from "react";

interface MainSidebarProps {
  panelRef: RefObject<PanelImperativeHandle | null>;
  projectName: string;
  onOpenSettings: () => void;
  onOpenProjectPicker: () => void;
}

export function MainSidebar({
  panelRef,
  projectName,
  onOpenSettings,
  onOpenProjectPicker,
}: MainSidebarProps) {
  const { t } = useTranslation();

  return (
    <Panel
      id="panel-sidebar"
      panelRef={panelRef}
      defaultSize={260}
      minSize={200}
      maxSize={450}
      className="flex flex-col border-r border-border-muted/30 bg-bg-surface overflow-hidden relative z-20"
    >
      {/* Sidebar Header */}
      <div className="p-4 space-y-4">
        <div
          className="flex items-center gap-2.5 group cursor-pointer"
          onClick={onOpenSettings}
        >
          <div className="w-8 h-8 rounded-lg bg-primary-500 flex items-center justify-center text-white transition-all group-active:scale-95">
            <Rocket size={16} />
          </div>
          <div className="flex flex-col">
            <h1 className="text-[14px] font-bold leading-none">
              <span className="text-primary-500">Maestro</span>
            </h1>
            <span className="text-[10px] font-medium text-text-muted/60">
              v0.1.0
            </span>
          </div>
        </div>

        <div className="space-y-1">
          <div
            className="flex items-center justify-between py-2 group cursor-pointer"
            onClick={onOpenProjectPicker}
          >
            <div className="flex flex-col min-w-0">
              <span className="text-[10px] font-bold text-text-muted/60 uppercase tracking-wider">
                {t("active_project")}
              </span>
              <span className="text-[13px] font-bold truncate text-text-main pr-2 mt-0.5 group-hover:text-primary-500 transition-colors">
                {projectName}
              </span>
            </div>
            <button className="shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-text-muted hover:text-text-main hover:bg-bg-elevated transition-colors">
              <Plus size={14} />
            </button>
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
          onClick={onOpenSettings}
        >
          <Settings2 size={16} />
          <span className="text-xs font-semibold">{t("nav_setup")}</span>
          <div className="ml-auto opacity-40">
            <ChevronRight size={12} />
          </div>
        </Button>
      </div>
    </Panel>
  );
}
