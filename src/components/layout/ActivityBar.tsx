import { Plus, Settings2 } from "lucide-react";
import { useAppStore } from "../../stores/appStore";
import { useShallow } from "zustand/react/shallow";
import { cn } from "../../lib/utils";
import { useTranslation } from "../../i18n";
import type { Workspace } from "../../types";

interface ActivityBarProps {
  onOpenSettings: () => void;
  isSettingsOpen?: boolean;
  onCreateWorkspace: () => void;
}

function WorkspaceIcon({ workspace, isActive }: { workspace: Workspace; isActive: boolean }) {
  const initial = workspace.name.charAt(0).toUpperCase();
  const bgColor = workspace.color || "#6366f1";

  return (
    <div
      className={cn(
        "relative w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-sm cursor-pointer transition-all group",
        isActive
          ? "rounded-lg shadow-md scale-105"
          : "hover:rounded-lg opacity-70 hover:opacity-100"
      )}
      style={{ backgroundColor: bgColor }}
      title={workspace.name}
    >
      {workspace.icon || initial}
      {/* Pure Chat badge */}
      {!workspace.workingDirectory && (
        <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-bg-surface flex items-center justify-center">
          <div className="w-2 h-2 rounded-full bg-amber-400" title="Pure Chat" />
        </div>
      )}
    </div>
  );
}

export function ActivityBar({
  onOpenSettings,
  isSettingsOpen = false,
  onCreateWorkspace,
}: ActivityBarProps) {
  const { t } = useTranslation();
  const { workspaces, activeWorkspaceId, setActiveWorkspaceId, setShowSettings } = useAppStore(
    useShallow((s) => ({
      workspaces: s.workspaces,
      activeWorkspaceId: s.activeWorkspaceId,
      setActiveWorkspaceId: s.setActiveWorkspaceId,
      setShowSettings: s.setShowSettings,
    }))
  );

  return (
    <div className="w-[60px] h-full flex flex-col items-center py-3 bg-transparent z-30 shrink-0 relative transition-all gap-2">
      {/* Workspace List */}
      <div className="flex flex-col items-center gap-2 flex-1 overflow-y-auto custom-scrollbar w-full px-2.5">
        {workspaces.map((ws) => {
          const isActive = ws.id === activeWorkspaceId && !isSettingsOpen;
          return (
            <div key={ws.id} className="relative" onClick={() => {
              setActiveWorkspaceId(ws.id);
              setShowSettings(false);
            }}>
              <WorkspaceIcon workspace={ws} isActive={isActive} />
              {isActive && (
                <div className="absolute -left-2.5 top-1/2 -translate-y-1/2 w-1 h-5 bg-white rounded-r-full shadow-sm" />
              )}
            </div>
          );
        })}

        {/* Add Workspace Button */}
        <button
          onClick={onCreateWorkspace}
          className="w-10 h-10 rounded-xl border-2 border-dashed border-border-muted/40 flex items-center justify-center text-text-muted/40 hover:text-text-muted hover:border-border-muted/60 transition-all hover:bg-bg-elevated/30 active:scale-95"
          title={t("create_workspace") || "New Workspace"}
        >
          <Plus size={18} strokeWidth={2} />
        </button>
      </div>

      {/* Separator */}
      <div className="w-8 h-px bg-border-muted/20 my-1" />

      {/* Bottom Actions */}
      <div className="flex flex-col gap-2 w-full px-2.5">
        <button
          onClick={onOpenSettings}
          className={cn(
            "w-10 h-10 mx-auto flex items-center justify-center rounded-xl transition-all relative group",
            isSettingsOpen
              ? "text-primary-500 bg-primary-500/10 shadow-glow"
              : "text-text-muted hover:text-text-main hover:bg-bg-elevated/60"
          )}
          title={t("nav_setup")}
        >
          <Settings2 size={19} className="stroke-[1.5px] group-hover:rotate-45 transition-transform" />
          {isSettingsOpen && (
            <div className="absolute -left-2.5 top-1/2 -translate-y-1/2 w-1 h-5 bg-primary-500 rounded-r-full" />
          )}
        </button>
      </div>
    </div>
  );
}
