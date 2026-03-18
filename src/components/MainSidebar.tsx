import { Panel, type PanelImperativeHandle } from "react-resizable-panels";
import { TaskSidebar } from "./TaskSidebar";
import { useTranslation } from "../i18n";
import { useAppStore } from "../stores/appStore";
import type { RefObject } from "react";

interface MainSidebarProps {
  panelRef: RefObject<PanelImperativeHandle | null>;
}

export function MainSidebar({
  panelRef,
}: MainSidebarProps) {
  const { t } = useTranslation();
  
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
  const workspaces = useAppStore((s) => s.workspaces);
  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId);

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
      <div className="h-14 flex items-center px-6 border-b border-border-muted/10">
        <h2 className="text-sm font-bold text-text-main tracking-tight truncate" title={activeWorkspace?.name}>
          {activeWorkspace ? activeWorkspace.name : (t("active_tasks") || "Session Tasks")}
        </h2>
      </div>

      <div className="flex-1 min-h-0 px-1 overflow-hidden">
        <TaskSidebar />
      </div>
    </Panel>
  );
}
