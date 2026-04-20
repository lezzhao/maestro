import { memo, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { cn } from "../../lib/utils";
import { useTranslation } from "../../i18n";
import { useActiveWorkspace, useWorkspaceStoreState, useAppUiState } from "../../hooks/use-app-store-selectors";
import { createPortal } from "react-dom";
import { useRef, useEffect } from "react";

interface WorkspaceSelectorProps {
  onCreateWorkspace: () => void;
}

export const WorkspaceSelector = memo(function WorkspaceSelector({
  onCreateWorkspace,
}: WorkspaceSelectorProps) {
  const { t } = useTranslation();
  const activeWorkspace = useActiveWorkspace();
  const { workspaces, setActiveWorkspaceId } = useWorkspaceStoreState();
  const { setShowSettings } = useAppUiState();
  const [isWorkspaceMenuOpen, setIsWorkspaceMenuOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [coords, setCoords] = useState({ top: 0, left: 0, width: 0 });

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isWorkspaceMenuOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setCoords({
        top: rect.bottom,
        left: rect.left,
        width: rect.width
      });
    }
    setIsWorkspaceMenuOpen(!isWorkspaceMenuOpen);
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (isWorkspaceMenuOpen && 
          triggerRef.current && 
          !triggerRef.current.contains(target) &&
          !target.closest('.workspace-portal-content')) {
        setIsWorkspaceMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isWorkspaceMenuOpen]);

  return (
    <div className="relative shrink-0 px-2 py-0 bg-background/5">
      <button 
        ref={triggerRef}
        onClick={handleOpen}
        className="w-full flex items-center px-2 py-2 rounded-xl bg-transparent transition-all hover:bg-white/[0.03] group active:scale-[0.98]"
      >
        <div className="flex items-center gap-3 w-full">
          <div 
            className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-black text-xs shadow-sm transition-transform group-hover:scale-105 inner-border"
            style={{
              backgroundColor: activeWorkspace?.color || "hsl(var(--primary))",
              background: `linear-gradient(135deg, ${activeWorkspace?.color || "hsl(var(--primary))"} 0%, ${activeWorkspace?.color || "hsl(var(--primary))"}cc 100%)`,
            }}
          >
            {activeWorkspace?.name.charAt(0).toUpperCase() || "?"}
          </div>
          <div className="flex flex-col min-w-0 flex-1 text-left">
            <h2 className="text-[13px] font-bold text-foreground tracking-tight truncate flex items-center gap-1.5" title={activeWorkspace?.name}>
              {activeWorkspace ? activeWorkspace.name : (t("active_tasks") || "Session Tasks")}
              <ChevronDown size={12} className={cn("text-muted-foreground/20 transition-transform duration-500", isWorkspaceMenuOpen && "rotate-180")} />
            </h2>
          </div>
        </div>
      </button>

      {/* Workspace Dropdown - Portaled */}
      {isWorkspaceMenuOpen && createPortal(
        <div 
          style={{ 
            position: 'fixed', 
            top: `${coords.top + 6}px`, 
            left: `${coords.left}px`,
            width: `${coords.width}px`,
          }}
          className="bg-popover/95 backdrop-blur-xl border border-border shadow-2xl z-dropdown py-3 rounded-2xl animate-in fade-in zoom-in-95 duration-200 origin-top workspace-portal-content"
        >
          <div className="max-h-60 overflow-y-auto px-2 space-y-1 no-scrollbar">
             {workspaces.map((ws) => (
               <button
                 key={ws.id}
                 onClick={() => {
                   setActiveWorkspaceId(ws.id);
                   setIsWorkspaceMenuOpen(false);
                   setShowSettings(false);
                 }}
                 className={cn(
                   "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all text-left group/item",
                   ws.id === activeWorkspace?.id 
                     ? "bg-primary/10 text-primary font-bold shadow-inner" 
                     : "text-muted-foreground hover:bg-muted hover:text-foreground"
                 )}
               >
                 <div 
                   className="w-6 h-6 rounded-md flex items-center justify-center text-white font-bold text-[10px] shrink-0 opacity-80 group-hover/item:opacity-100"
                   style={{ backgroundColor: ws.color || "hsl(var(--primary))" }}
                 >
                   {ws.name.charAt(0).toUpperCase()}
                 </div>
                 <span className="truncate flex-1 tracking-tight">{ws.name}</span>
                 {ws.id === activeWorkspace?.id && <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />}
               </button>
             ))}
          </div>
          <div className="mt-2 pt-2 px-3 border-t border-border/10">
            <button
              onClick={() => {
                onCreateWorkspace();
                setIsWorkspaceMenuOpen(false);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[12px] font-bold text-muted-foreground/60 tracking-tight hover:text-primary hover:bg-primary/5 transition-all group/add"
            >
              <Plus size={14} className="group-hover/add:rotate-90 transition-transform" />
              <span>{t("create_workspace") || "New Workspace"}</span>
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
});
