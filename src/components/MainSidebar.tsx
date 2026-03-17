import { Panel, type PanelImperativeHandle } from "react-resizable-panels";
import { TaskSidebar } from "./TaskSidebar";
import { useTranslation } from "../i18n";
import type { RefObject } from "react";

interface MainSidebarProps {
  panelRef: RefObject<PanelImperativeHandle | null>;
  projectName: string;
  activeTab: "explorer" | "tasks";
}

export function MainSidebar({
  panelRef,
  projectName,
  activeTab,
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
      {/* Sidebar Header (Contextual) */}
      <div className="p-3 border-b border-border-muted/20">
        <h2 className="text-[11px] font-bold text-text-muted/80 uppercase tracking-widest pl-1">
          {activeTab === "tasks" ? (t("active_tasks") || "Session Tasks") : "Explorer"}
        </h2>
        {activeTab === "explorer" && (
          <div className="mt-2 pl-1 h-6 flex items-center">
            <span className="text-[12px] font-bold truncate text-text-main">
              {projectName}
            </span>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 px-1 overflow-hidden">
        {activeTab === "tasks" ? (
          <TaskSidebar />
        ) : (
          <div className="p-4 text-center text-[11px] text-text-muted">
            Explorer File Tree (Coming Soon)
          </div>
        )}
      </div>
    </Panel>
  );
}
