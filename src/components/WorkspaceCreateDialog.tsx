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
      className="fixed inset-0 flex items-center justify-center p-4 bg-background/80 backdrop-blur-md animate-in fade-in duration-500"
      style={{ zIndex: Z_INDEX.DIALOG }}
    >
      <div className="w-[480px] bg-card border border-border/60 rounded-[2.5rem] shadow-2xl shadow-black/20 overflow-hidden animate-in zoom-in-[0.98] slide-in-from-bottom-4 duration-500">
        {/* Premium Header */}
        <div className="flex items-center justify-between px-10 pt-10 pb-6">
          <div className="space-y-1.5">
            <h2 className="text-2xl font-bold text-foreground tracking-tight">Create Workspace</h2>
            <p className="text-[11px] font-bold text-muted-foreground/40 uppercase tracking-[0.1em]">Set up your next project environment</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground/30 hover:text-foreground p-2.5 rounded-full hover:bg-muted transition-all active:scale-95">
            <X size={24} />
          </button>
        </div>

        <div className="px-10 pb-10 space-y-8">
          <div className="space-y-7">
            {/* Error Message */}
            {error && (
              <div className="p-4 rounded-2xl bg-destructive/5 border border-destructive/20 animate-in slide-in-from-top-2 duration-300">
                <p className="text-[11px] font-bold text-destructive uppercase tracking-widest">Configuration Error</p>
                <p className="text-[12px] text-destructive/80 font-medium leading-relaxed mt-0.5">{error}</p>
              </div>
            )}

            {/* Project Name */}
            <div className="space-y-3">
              <label className="text-[11px] font-bold text-muted-foreground/50 uppercase tracking-[0.15em] ml-1">Workspace Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="E.g., Maestro Project..."
                className="w-full h-14 px-6 text-[15px] font-bold rounded-2xl border border-border/40 bg-muted/30 text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/40 focus:ring-4 focus:ring-primary/5 transition-all duration-300"
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
            </div>

            {/* Directory Selection */}
            <div className="space-y-3">
              <label className="text-[11px] font-bold text-muted-foreground/50 uppercase tracking-[0.15em] ml-1">
                Local Folder <span className="opacity-40 normal-case font-medium ml-1">(Optional)</span>
              </label>
              <div className="flex gap-3">
                <input
                  type="text"
                  value={workingDirectory}
                  onChange={(e) => setWorkingDirectory(e.target.value)}
                  placeholder="Chat-only mode"
                  className="flex-1 h-14 px-6 text-[12px] font-mono font-medium rounded-2xl border border-border/40 bg-muted/30 text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/40 transition-all duration-300 truncate"
                />
                <button
                  type="button"
                  className="w-14 h-14 flex items-center justify-center rounded-2xl bg-muted border border-border/40 text-muted-foreground/60 hover:text-primary hover:border-primary/40 transition-all shadow-sm active:scale-95 group"
                  onClick={() => void handlePickDirectory()}
                  title="Choose Folder"
                >
                  <FolderOpen size={20} className="group-hover:scale-110 transition-transform" />
                </button>
              </div>
            </div>

            {/* Active Core Indicator */}
            <div className={cn(
               "flex items-center gap-5 p-5 rounded-2xl border transition-all duration-500",
               isPureChat 
                ? "bg-amber-500/5 border-amber-500/10" 
                : "bg-primary/5 border-primary/10"
            )}>
              <div className={cn(
                "w-12 h-12 flex items-center justify-center rounded-xl transition-all duration-500",
                isPureChat ? "bg-amber-500/10 text-amber-500" : "bg-primary/10 text-primary"
              )}>
                {isPureChat ? <MessageSquare size={22} /> : <FolderTree size={22} />}
              </div>
              <div className="space-y-1">
                 <p className={cn("text-[12px] font-bold uppercase tracking-[0.05em]", isPureChat ? "text-amber-600/90" : "text-primary/90")}>
                   {isPureChat ? "Direct Inference" : "Agent Orchestration"}
                 </p>
                 <p className="text-[11px] text-muted-foreground/70 font-medium leading-[1.4]">
                   {isPureChat ? "Ultra-fast LLM interaction with zero disk footprint." : "Full file-system access with autonomous task execution."}
                 </p>
              </div>
            </div>

            {/* Visual Identity */}
            <div className="space-y-4 pt-1">
              <label className="text-[11px] font-bold text-muted-foreground/50 uppercase tracking-[0.15em] ml-1">Workspace Color</label>
              <div className="flex flex-wrap gap-3.5 pl-1">
                {WORKSPACE_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    className="w-7 h-7 rounded-full transition-all group relative border-2 border-transparent"
                    style={{ backgroundColor: c, opacity: color === c ? 1 : 0.6 }}
                  >
                    {color === c && (
                      <div className="absolute -inset-1.5 rounded-full border-2 border-primary/30 animate-in fade-in zoom-in duration-500" />
                    )}
                    <div className="absolute inset-0 rounded-full opacity-0 group-hover:opacity-10 shadow-inner bg-white" />
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Action Hub */}
          <div className="flex gap-4 pt-6">
            <Button
              variant="secondary"
              onClick={onClose}
              className="flex-1 h-14 text-[11px] font-bold uppercase tracking-[0.1em] rounded-2xl"
            >
              Cancel
            </Button>
            <Button
              disabled={!name.trim() || creating}
              onClick={() => void handleCreate()}
              className={cn(
                "flex-[1.5] h-14 font-bold text-[11px] uppercase tracking-[0.1em] rounded-2xl shadow-xl shadow-primary/10 transition-all active:scale-[0.98]",
                !creating && name.trim() ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-muted text-muted-foreground/40"
              )}
            >
              {creating ? "Connecting..." : "Create Workspace"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
