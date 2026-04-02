import { useState, useCallback } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FolderOpen, X, MessageSquare, FolderTree } from "lucide-react";
import { useProjectStoreState, useTaskStoreState, useWorkspaceStoreState } from "../hooks/use-app-store-selectors";
import { setCurrentProjectCommand } from "../hooks/commands/project-commands";
import { createWorkspaceCommand } from "../hooks/commands/workspace-commands";
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
  const [creating, setCreating] = useState(false);

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

  const handleCreate = useCallback(async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
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
      addWorkspace(ws);
      setActiveWorkspaceId(ws.id);
      await setCurrentProjectCommand(workingDirectory.trim() || "");
      setProjectPath(workingDirectory.trim());
      void addTask("Initial Task").catch(console.error);
      setName("");
      setWorkingDirectory("");
      onClose();
    } catch (e) {
      console.error("Failed to create workspace:", e);
    } finally {
      setCreating(false);
    }
  }, [name, workingDirectory, color, addWorkspace, setActiveWorkspaceId, setProjectPath, addTask, onClose]);

  if (!open) return null;

  const isPureChat = !workingDirectory;

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center p-4 bg-bg-base/60 backdrop-blur-xl animate-in fade-in duration-300">
      <div className="w-[400px] bg-bg-surface border border-border-muted rounded-md shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Simple Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-2">
          <h2 className="text-lg font-bold text-text-main tracking-tight">新建 Workspace</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-main p-1.5 rounded-full hover:bg-bg-subtle transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 pb-6 space-y-6">
          <div className="space-y-4 pt-2">
            {/* Project Name */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-text-muted/60 uppercase tracking-widest">名称</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Project"
                className="w-full h-10 px-3 text-sm rounded-sm border border-border-muted bg-bg-base/30 text-text-main placeholder:text-text-muted/30 focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all font-medium"
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
            </div>

            {/* Directory */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-text-muted/60 uppercase tracking-wider">
                工作目录 <span className="text-[10px] opacity-40 lowercase italic font-normal">(可选)</span>
              </label>
                  <div className="flex-2 space-y-3">
                <input
                  type="text"
                  value={workingDirectory}
                  onChange={(e) => setWorkingDirectory(e.target.value)}
                  placeholder="留空为纯对话模式"
                  className="flex-1 h-10 px-3 text-[12px] font-mono rounded-sm border border-border-muted bg-bg-base/30 text-text-main placeholder:text-text-muted/20 focus:outline-none focus:border-primary/50 transition-all truncate"
                />
                <button
                  type="button"
                  className="p-2 rounded-sm bg-bg-elevated border border-border-muted text-text-muted hover:text-primary transition-all shadow-sm"
                  onClick={() => void handlePickDirectory()}
                >
                  <FolderOpen size={16} />
                </button>
              </div>
            </div>

            {/* Mode Select Indicator */}
            <div className={cn(
              "flex items-center gap-3 p-3 rounded-sm border transition-all",
              isPureChat ? "bg-amber-500/5 border-amber-500/10" : "bg-emerald-500/5 border-emerald-500/10"
            )}>
              <div className={cn(
                "p-2 rounded-sm",
                isPureChat ? "bg-amber-500/10 text-amber-600" : "bg-emerald-500/10 text-emerald-600"
              )}>
                {isPureChat ? <MessageSquare size={16} /> : <FolderTree size={16} />}
              </div>
              <div className="space-y-0.5">
                 <p className={cn("text-xs font-bold", isPureChat ? "text-amber-600" : "text-emerald-600")}>
                   {isPureChat ? "纯 API 对话模式" : "工作区 Agent 模式"}
                 </p>
                 <p className="text-[10px] text-text-muted leading-tight opacity-60">
                   {isPureChat ? "无本地文件权限，极速流式对话" : "Agent 拥有本地代码读写与执行权限"}
                 </p>
              </div>
            </div>

            {/* Accent Selection */}
            <div className="space-y-2">
              <label className="text-[11px] font-bold text-text-muted/60 uppercase tracking-widest pl-0.5">颜色标识</label>
              <div className="flex flex-wrap gap-2.5">
                {WORKSPACE_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    className="w-5 h-5 rounded-full transition-all group relative"
                    style={{ backgroundColor: c }}
                  >
                    {color === c && (
                      <div className="absolute inset-0 rounded-full ring-2 ring-primary ring-offset-2 ring-offset-bg-surface" />
                    )}
                    <div className="absolute inset-0 rounded-full opacity-0 group-hover:opacity-10 shadow-inner bg-white" />
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex gap-2.5 pt-2">
            <Button
              variant="ghost"
              onClick={onClose}
              className="flex-1 h-10 text-xs font-semibold text-text-muted hover:text-text-main rounded-sm"
            >
              取消
            </Button>
            <Button
              disabled={!name.trim() || creating}
              onClick={() => void handleCreate()}
              className="flex-2 h-10 bg-text-main hover:bg-text-main/90 text-bg-surface font-bold text-xs rounded-sm shadow-sm transition-all uppercase tracking-widest"
            >
              {creating ? "正在初始化..." : "创建并开始"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
