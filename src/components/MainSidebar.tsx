import { Panel, type PanelImperativeHandle } from "react-resizable-panels";
import { TaskSidebar } from "./TaskSidebar";
import { useTranslation } from "../i18n";
import { useActiveWorkspace } from "../hooks/use-app-store-selectors";
import type { RefObject } from "react";

interface MainSidebarProps {
  panelRef: RefObject<PanelImperativeHandle | null>;
}

export function MainSidebar({
  panelRef,
}: MainSidebarProps) {
  const { t } = useTranslation();
  const activeWorkspace = useActiveWorkspace();

  return (
    <Panel
      id="panel-sidebar"
      panelRef={panelRef}
      defaultSize={260}
      minSize={200}
      maxSize={450}
      className="flex flex-col bg-bg-surface/40 backdrop-blur-2xl overflow-hidden relative z-20 border-r border-border-muted/5 shadow-[2px_0_12px_rgba(0,0,0,0.02)]"
    >
      {/* Sidebar Header (Contextual) */}
      <div className="h-14 flex items-center px-6 pt-2 shrink-0">
        <h2 className="text-[13px] font-extrabold text-text-main tracking-tight truncate" title={activeWorkspace?.name}>
          {activeWorkspace ? activeWorkspace.name : (t("active_tasks") || "Session Tasks")}
        </h2>
      </div>

      <div className="flex-1 min-h-0 px-1 overflow-hidden">
        <TaskSidebar />
      </div>


    </Panel>
  );
}
