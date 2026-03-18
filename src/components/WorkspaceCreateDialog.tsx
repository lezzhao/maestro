import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FolderOpen, X, MessageSquare, FolderTree } from "lucide-react";
import { useAppStore } from "../stores/appStore";
import { Button } from "./ui/button";
import { toast } from "sonner";
import type { Workspace } from "../types";

const WORKSPACE_COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#ef4444",
  "#f97316", "#eab308", "#22c55e", "#14b8a6",
  "#06b6d4", "#3b82f6",
];

interface WorkspaceCreateDialogProps {
  open: boolean;
  onClose: () => void;
}

export function WorkspaceCreateDialog({ open, onClose }: WorkspaceCreateDialogProps) {
  const addWorkspace = useAppStore((s) => s.addWorkspace);
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
          const parts = selected.split("/");
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
      const ws = await invoke<Workspace>("workspace_create", {
        request: {
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
        },
      });
      addWorkspace(ws);
      setName("");
      setWorkingDirectory("");
      setColor(WORKSPACE_COLORS[Math.floor(Math.random() * WORKSPACE_COLORS.length)]);
      onClose();
    } catch (e) {
      console.error("Failed to create workspace:", e);
      // @ts-expect-error - e is unknown, but we check for message
      const errorMsg = e?.message || String(e);
      toast.error("Failed to create workspace", { description: errorMsg });
    } finally {
      setCreating(false);
    }
  }, [name, workingDirectory, color, addWorkspace, onClose]);

  if (!open) return null;

  const isPureChat = !workingDirectory;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-[420px] bg-bg-surface border border-border-muted/40 rounded-2xl shadow-xl overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <h2 className="text-base font-bold text-text-main">新建 Workspace</h2>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-main p-1 rounded-lg hover:bg-bg-elevated transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-6 pb-6 space-y-5">
          {/* Name */}
          <div className="space-y-2">
            <label className="text-[11px] font-semibold text-text-muted/70 uppercase">名称</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Project"
              className="w-full h-9 px-3 text-sm rounded-lg border border-border-muted/50 bg-bg-base text-text-main placeholder:text-text-muted/30 focus:outline-none focus:border-primary-500/50 focus:ring-1 focus:ring-primary-500/20 transition-all"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
          </div>

          {/* Working Directory */}
          <div className="space-y-2">
            <label className="text-[11px] font-semibold text-text-muted/70 uppercase">
              工作目录 <span className="text-text-muted/40 normal-case font-normal">(可选)</span>
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={workingDirectory}
                onChange={(e) => setWorkingDirectory(e.target.value)}
                placeholder="不配置则为纯对话模式"
                className="flex-1 h-9 px-3 text-xs rounded-lg border border-border-muted/50 bg-bg-base text-text-main placeholder:text-text-muted/30 focus:outline-none focus:border-primary-500/50 transition-all font-mono truncate"
              />
              <Button
                variant="outline"
                size="sm"
                className="h-9 px-3 rounded-lg border-border-muted/50 hover:bg-bg-elevated text-text-muted hover:text-text-main"
                onClick={() => void handlePickDirectory()}
              >
                <FolderOpen size={14} />
              </Button>
            </div>
          </div>

          {/* Color Picker */}
          <div className="space-y-2">
            <label className="text-[11px] font-semibold text-text-muted/70 uppercase">颜色</label>
            <div className="flex gap-2">
              {WORKSPACE_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className="w-6 h-6 rounded-full transition-all hover:scale-110 active:scale-95"
                  style={{
                    backgroundColor: c,
                    outline: color === c ? "2px solid white" : "none",
                    outlineOffset: "2px",
                    boxShadow: color === c ? `0 0 0 1px ${c}` : "none",
                  }}
                />
              ))}
            </div>
          </div>

          {/* Mode Indicator */}
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-bg-base border border-border-muted/30">
            {isPureChat ? (
              <>
                <MessageSquare size={14} className="text-amber-500" />
                <span className="text-xs text-text-muted">
                  <span className="font-semibold text-amber-500">Pure Chat</span> — 纯 API 对话，无文件读写权限
                </span>
              </>
            ) : (
              <>
                <FolderTree size={14} className="text-emerald-500" />
                <span className="text-xs text-text-muted">
                  <span className="font-semibold text-emerald-500">Workspace</span> — Agent 拥有文件读写权限
                </span>
              </>
            )}
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="text-text-muted hover:text-text-main"
            >
              取消
            </Button>
            <Button
              size="sm"
              disabled={!name.trim() || creating}
              onClick={() => void handleCreate()}
              className="bg-primary-500 hover:bg-primary-600 text-white font-semibold px-5"
            >
              {creating ? "创建中..." : "创建"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
