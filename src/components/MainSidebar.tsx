import { Panel, type PanelImperativeHandle } from "react-resizable-panels";
import { ChevronDown, Plus, Settings2 } from "lucide-react";
import { TaskSidebar } from "./TaskSidebar";
import { ConversationSidebar } from "./ConversationSidebar";
import { GlobalSearch } from "./GlobalSearch";
import { useTranslation } from "../i18n";
import { useActiveWorkspace, useWorkspaceStoreState, useAppUiState } from "../hooks/use-app-store-selectors";
import type { RefObject } from "react";
import { cn } from "../lib/utils";
import { WorkspaceSelector } from "./sidebar/WorkspaceSelector";
import { PanelHeader } from "./ui/PanelHeader";
import { SkillSidebarSection } from "./sidebar/SkillSidebarSection";

interface MainSidebarProps {
  panelRef: RefObject<PanelImperativeHandle | null>;
  onOpenSettings: () => void;
  onCreateWorkspace: () => void;
}

export function MainSidebar({
  panelRef,
  onOpenSettings,
  onCreateWorkspace,
}: MainSidebarProps) {
  const { t } = useTranslation();
  const { setShowSkillGallery, setShowSettings } = useAppUiState();

  return (
    <Panel
      id="panel-sidebar"
      panelRef={panelRef}
      defaultSize={260}
      minSize={220}
      maxSize={450}
      className="flex flex-col bg-background/40 backdrop-blur-3xl relative z-sidebar border-r border-white/[0.04] dark:border-white/[0.02]"
    >
      <PanelHeader 
        title={
          <h2 className="text-[11px] font-black text-muted-foreground/40 uppercase tracking-[0.2em] leading-none">
            {t("workspace_label")}
          </h2>
        }
        className="bg-white/[0.02]"
      />
      <WorkspaceSelector onCreateWorkspace={onCreateWorkspace} />

      <div className="px-2">
        <GlobalSearch />
      </div>

      {/* Unified Scrollable Area */}
      <div className="flex-1 overflow-y-auto no-scrollbar py-4 space-y-8">
        <section>
          <TaskSidebar />
        </section>

        <section>
          <ConversationSidebar />
        </section>

        <section>
          <SkillSidebarSection onOpenGallery={() => setShowSkillGallery(true)} />
        </section>
      </div>

      {/* Sidebar Footer with Settings - Refined Premium */}
      <div className="p-4 mt-auto border-t border-white/[0.04] dark:border-white/[0.02] bg-white/[0.01]">
        <button
          onClick={onOpenSettings}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-muted-foreground/50 hover:text-foreground hover:bg-white/[0.03] transition-all group active:scale-[0.98] inner-border"
        >
          <div className="w-8 h-8 rounded-xl bg-white/[0.03] flex items-center justify-center transition-all group-hover:bg-primary/10 group-hover:text-primary group-hover:rotate-12">
            <Settings2 size={16} />
          </div>
          <span className="text-[14px] font-bold tracking-tight">{t("nav_setup")}</span>
        </button>
      </div>
    </Panel>
  );
}
