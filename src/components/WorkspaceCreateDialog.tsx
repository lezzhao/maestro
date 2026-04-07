import { useState, useCallback } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FolderOpen, X, MessageSquare, FolderTree } from "lucide-react";
import { useProjectStoreState, useTaskStoreState, useWorkspaceStoreState } from "../hooks/use-app-store-selectors";
import { setCurrentProjectCommand } from "../hooks/commands/project-commands";
import { createWorkspaceCommand } from "../hooks/commands/workspace-commands";
import { useAsyncCallback } from "../hooks/use-async-callback";
import { Z_INDEX } from "../constants";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";

const WORKSPACE_COLORS = [
  "#3b82f6", "#0ea5e9", "#10b981", "#6366f1", 
  "#8b5cf6", "#d946ef", "#f43f5e", "#f59e0b", 
  "#64748b", "#0f172a"
];

interface WorkspaceCreateDialogProps {
  open: boolean;
  onClose: () => void;
}

export function WorkspaceCreateDialog({ open, onClose }: WorkspaceCreateDialogProps) {
  const { addWorkspace, setActiveWorkspaceId } = useWorkspaceStoreState();
  const { setProjectPath } = useProjectStoreState();
  const { addTask } = useTaskStoreState();
  const [name, setName] = useState("");
  const [workingDirectory, setWorkingDirectory] = useState("");
  const [color, setColor] = useState(WORKSPACE_COLORS[0]);

  const handlePickDirectory = useCallback(async () => {
    try {
      const selected = await openDialog({ directory: true, multiple: false });
      if (selected && typeof selected === "string") {
        setWorkingDirectory(selected);
        if (!name) {
          // Normalize to forward slashes for cross-platform split
          const parts = selected.replace(/\\/g, "/").split("/");
          setName(parts[parts.length - 1] || "");
        }
      }
    } catch (e) {
      console.error("Failed to pick directory:", e);
    }
  }, [name]);

  const { execute: handleCreate, isLoading: creating, error } = useAsyncCallback(
    async () => {
      if (!name.trim()) return;
      
      const ws = await createWorkspaceCommand({
        name: name.trim(),
        workingDirectory: workingDirectory || null,
        icon: null,
        color,
        preferredEngineId: null,
        preferredProfileId: null,
        specProvider: null,
        specMode: null,
        specTargetIde: null,
        settings: null,
      });

      // Sequence is critical for task creation context
      // We pass ws.id explicitly to addTask to avoid Zustand state sync delay
      addWorkspace(ws);
      setActiveWorkspaceId(ws.id);
      
      // Only set project path if it exists (Agent Mode)
      if (workingDirectory.trim()) {
        await setCurrentProjectCommand(workingDirectory.trim());
        setProjectPath(workingDirectory.trim());
      } else {
        // Clear project path for Pure API mode to avoid contamination
        setProjectPath("");
      }

      await addTask("Initial Task", ws.id);
      
      setName("");
      setWorkingDirectory("");
      onClose();
    },
    { errorMessagePrefix: "workspace_create_fail" }
  );

  if (!open) return null;

  const isPureChat = !workingDirectory;

  return (
    <div 
      className="fixed inset-0 flex items-center justify-center p-4 bg-black/40 backdrop-blur-md animate-in fade-in duration-500"
      style={{ zIndex: Z_INDEX.DIALOG }}
    >
      <div className="w-[440px] bg-bg-surface border border-border-muted/20 rounded-3xl shadow-[0_32px_64px_-16px_rgba(0,0,0,0.4)] overflow-hidden animate-in zoom-in-[0.98] slide-in-from-bottom-4 duration-300">
        {/* Premium Header */}
        <div className="flex items-center justify-between px-8 pt-8 pb-4">
          <div className="space-y-1">
            <h2 className="text-xl font-black text-text-main tracking-tight uppercase">New Workspace</h2>
            <p className="text-[10px] font-bold text-text-muted/40 uppercase tracking-widest">Architect your next mission</p>
          </div>
          <button onClick={onClose} className="text-text-muted/40 hover:text-text-main p-2 rounded-full hover:bg-bg-subtle transition-all active:scale-90">
            <X size={20} />
          </button>
        </div>

        <div className="px-8 pb-8 space-y-8">
          <div className="space-y-6 pt-2">
            {/* Error Message */}
            {error && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 animate-in slide-in-from-top-2 duration-300">
                <p className="text-[10px] font-bold text-red-500 uppercase tracking-widest">System Error</p>
                <p className="text-[11px] text-red-400 font-medium leading-relaxed">{error}</p>
              </div>
            )}

            {/* Project Name */}
            <div className="space-y-2">
              <label className="text-[10px] font-black text-text-muted/50 uppercase tracking-[0.2em] pl-0.5">Title / Metadata</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Phoenix Project..."
                className="w-full h-12 px-4 text-sm font-bold rounded-2xl border border-border-muted/10 bg-bg-base/30 text-text-main placeholder:text-text-muted/20 focus:outline-none focus:border-primary/40 focus:ring-4 focus:ring-primary/5 transition-all"
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
            </div>

            {/* Directory Selection */}
            <div className="space-y-2">
              <label className="text-[10px] font-black text-text-muted/50 uppercase tracking-[0.2em] pl-0.5">
                Target Pipeline <span className="opacity-30 normal-case italic font-medium ml-1">(Optional)</span>
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={workingDirectory}
                  onChange={(e) => setWorkingDirectory(e.target.value)}
                  placeholder="Pure Inference Mode"
                  className="flex-1 h-12 px-4 text-[11px] font-mono font-medium rounded-2xl border border-border-muted/10 bg-bg-base/30 text-text-main placeholder:text-text-muted/20 focus:outline-none focus:border-primary/40 transition-all truncate"
                />
                <button
                  type="button"
                  className="w-12 h-12 flex items-center justify-center rounded-2xl bg-bg-elevated border border-border-muted/20 text-text-muted/60 hover:text-primary hover:border-primary/40 transition-all shadow-sm active:scale-95"
                  onClick={() => void handlePickDirectory()}
                >
                  <FolderOpen size={18} />
                </button>
              </div>
            </div>

            {/* Active Core Indicator */}
            <div className={cn(
               "flex items-center gap-4 p-4 rounded-2xl border transition-all duration-500",
               isPureChat 
                ? "bg-amber-500/5 border-amber-500/10 shadow-inner" 
                : "bg-emerald-500/5 border-emerald-500/10 shadow-inner"
            )}>
              <div className={cn(
                "w-10 h-10 flex items-center justify-center rounded-xl",
                isPureChat ? "bg-amber-500/10 text-amber-500" : "bg-emerald-500/10 text-emerald-500"
              )}>
                {isPureChat ? <MessageSquare size={18} /> : <FolderTree size={18} />}
              </div>
              <div className="space-y-0.5">
                 <p className={cn("text-[11px] font-black uppercase tracking-widest", isPureChat ? "text-amber-600/80" : "text-emerald-600/80")}>
                   {isPureChat ? "Inference Stream" : "Agent Orchestration"}
                 </p>
                 <p className="text-[10px] text-text-muted/60 font-medium leading-tight">
                   {isPureChat ? "Zero disk footprint. Ultra-fast LLM interaction." : "Full file-system access with autonomous execution."}
                 </p>
              </div>
            </div>

            {/* Visual Identity */}
            <div className="space-y-3">
              <label className="text-[10px] font-black text-text-muted/50 uppercase tracking-[0.2em] pl-0.5">Branding / Color</label>
              <div className="flex flex-wrap gap-3">
                {WORKSPACE_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    className="w-6 h-6 rounded-full transition-all group relative saturate-[0.8] hover:saturate-[1.2] hover:scale-110"
                    style={{ backgroundColor: c }}
                  >
                    {color === c && (
                      <div className="absolute -inset-1 rounded-full border-2 border-primary/40 animate-in fade-in zoom-in duration-300" />
                    )}
                    <div className="absolute inset-0 rounded-full opacity-0 group-hover:opacity-10 shadow-inner bg-white" />
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Action Hub */}
          <div className="flex gap-3 pt-4">
            <Button
              variant="ghost"
              onClick={onClose}
              className="flex-1 h-12 text-[10px] font-black uppercase tracking-[0.2em] text-text-muted/40 hover:text-text-main hover:bg-bg-subtle rounded-2xl transition-all"
            >
              System Abort
            </Button>
            <Button
              disabled={!name.trim() || creating}
              onClick={() => void handleCreate()}
              className={cn(
                "flex-[1.5] h-12 font-black text-[10px] uppercase tracking-[0.2em] rounded-2xl shadow-lg transition-all active:scale-[0.98]",
                creating 
                  ? "bg-bg-elevated text-text-muted/40 cursor-wait" 
                  : "bg-primary text-white hover:bg-primary/90 hover:shadow-primary/20"
              )}
            >
              {creating ? "Launching Core..." : "Initiate Workspace"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
