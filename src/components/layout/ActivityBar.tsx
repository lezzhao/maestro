import { useState } from "react";
import { Plus, Settings2 } from "lucide-react";
import { useAppUiState, useWorkspaceStoreState } from "../../hooks/use-app-store-selectors";
import { deleteWorkspaceCommand } from "../../hooks/workspace-commands";
import { cn } from "../../lib/utils";
import { useTranslation } from "../../i18n";
import type { Workspace } from "../../types";
import { ChoiceDialog } from "../ui/choice-dialog";
import { toast } from "sonner";

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
        "relative w-10 h-10 rounded-md flex items-center justify-center text-white/90 font-bold text-sm cursor-pointer transition-all group overflow-hidden shadow-sm",
        isActive
          ? "opacity-100 ring-2 ring-primary/40 shadow-glow scale-105"
          : "opacity-60 hover:opacity-100 hover:scale-[1.05]"
      )}
      style={{ backgroundColor: bgColor }}
    >
      <span className="select-none tracking-tighter">{workspace.icon || initial}</span>
      
      {/* Pure Chat badge */}
      {!workspace.workingDirectory && (
        <div className="absolute top-1 left-1 w-1.5 h-1.5 rounded-full bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.6)]" />
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
  const [pendingDeleteWorkspace, setPendingDeleteWorkspace] = useState<Workspace | null>(null);
  const { workspaces, activeWorkspaceId, setActiveWorkspaceId } = useWorkspaceStoreState();
  const { setShowSettings } = useAppUiState();

  return (
    <div className="w-[64px] h-full flex flex-col items-center py-4 bg-bg-surface/80 backdrop-blur-2xl border-r border-border-muted/10 z-30 shrink-0 relative transition-all shadow-sm">
      {/* Workspace List Area - Scrolls if items exceed height */}
      <div className="flex flex-col items-center gap-1.5 flex-1 overflow-y-auto no-scrollbar w-full px-2">
        {workspaces.map((ws) => {
          const isActive = ws.id === activeWorkspaceId && !isSettingsOpen;
          return (
            <div 
              key={ws.id} 
              className="relative flex items-center justify-center w-full group/ws" 
              onContextMenu={(e) => {
                e.preventDefault();
                setPendingDeleteWorkspace(ws);
              }}
            >
              <div 
                className="cursor-pointer"
                onClick={() => {
                  setActiveWorkspaceId(ws.id);
                  setShowSettings(false);
                }}
              >
                <WorkspaceIcon workspace={ws} isActive={isActive} />
              </div>
              
              {isActive && (
                <div className="absolute left-[-10px] top-1/2 -translate-y-1/2 w-1 h-6 bg-primary rounded-r-full transition-all shadow-[0_0_8px_rgba(var(--primary-rgb),0.5)]" />
              )}
            </div>
          );
        })}

        {/* Add Workspace Button */}
        <button
          onClick={onCreateWorkspace}
          className="w-10 h-10 rounded-md border-2 border-dashed border-border-muted/20 flex items-center justify-center text-text-muted/30 hover:text-primary hover:border-primary/40 hover:bg-primary/5 hover:scale-105 transition-all group"
          title={t("create_workspace") || "New Workspace"}
        >
          <Plus size={20} strokeWidth={2.5} className="group-hover:rotate-90 transition-transform duration-300" />
        </button>
      </div>

      {/* Bottom Pinned Actions */}
      <div className="w-full flex flex-col gap-2 px-2 pt-4 border-t border-border-muted/5 mt-2">
        <button
          onClick={onOpenSettings}
          className={cn(
            "w-12 h-12 mx-auto flex items-center justify-center rounded-md transition-all relative group",
            isSettingsOpen
              ? "text-primary bg-primary/10"
              : "text-text-muted/40 hover:text-text-main hover:bg-bg-elevated/80 hover:scale-105 hover:shadow-lg"
          )}
          title={t("nav_setup")}
        >
          <Settings2 size={22} className={cn("transition-all duration-700", isSettingsOpen ? "rotate-180 scale-110" : "group-hover:rotate-45")} />
          {isSettingsOpen && (
            <div className="absolute left-[-10px] top-1/2 -translate-y-1/2 w-1 h-6 bg-primary rounded-r-full shadow-[0_0_8px_rgba(var(--primary-rgb),0.5)]" />
          )}
        </button>
      </div>

      <ChoiceDialog
        open={Boolean(pendingDeleteWorkspace)}
        title="删除 Workspace"
        description={
          pendingDeleteWorkspace
            ? `将删除工作区“${pendingDeleteWorkspace.name}”。此操作会移除该工作区入口。`
            : undefined
        }
        options={[
          {
            id: "delete-workspace",
            label: "确认删除",
            description: "立即删除当前工作区。",
            variant: "destructive",
            onSelect: async () => {
              if (!pendingDeleteWorkspace) return;
              try {
                await deleteWorkspaceCommand(pendingDeleteWorkspace.id);
              } catch (error) {
                toast.error(`删除工作区失败: ${String(error)}`);
                throw error;
              }
            },
          },
        ]}
        cancelLabel="保留工作区"
        onClose={() => setPendingDeleteWorkspace(null)}
      />
    </div>
  );
}
