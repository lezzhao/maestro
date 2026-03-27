import React, { useState, useEffect } from "react";
import { Settings, Save, AlertCircle } from "lucide-react";
import { useAppStore } from "../stores/appStore";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "./ui/button";

interface CascadingConfigPanelProps {
  taskId: string | null;
  workspaceId: string | null;
}

export const CascadingConfigPanel: React.FC<CascadingConfigPanelProps> = ({
  taskId,
  workspaceId,
}) => {
  const tasks = useAppStore((s) => s.tasks);
  const workspaces = useAppStore((s) => s.workspaces);
  const updateTaskRecord = useAppStore((s) => s.updateTaskRecord);
  const updateWorkspace = useAppStore((s) => s.updateWorkspace);

  const activeTask = tasks.find((t) => t.id === taskId);
  const activeWs = workspaces.find((w) => w.id === workspaceId);

  const [taskSettingsStr, setTaskSettingsStr] = useState(activeTask?.settings || "{}");
  const [wsSettingsStr, setWsSettingsStr] = useState(activeWs?.settings || "{}");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (activeTask?.settings) setTaskSettingsStr(activeTask.settings);
    if (activeWs?.settings) setWsSettingsStr(activeWs.settings);
  }, [activeTask?.settings, activeWs?.settings]);

  const handleSaveTask = async () => {
    if (!taskId) return;
    try {
      // Validate JSON
      JSON.parse(taskSettingsStr);
      await invoke("task_update", {
        request: {
          id: taskId,
          settings: taskSettingsStr,
        },
      });
      updateTaskRecord(taskId, { settings: taskSettingsStr });
      setError(null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError("Task Settings Invalid JSON: " + msg);
    }
  };

  const handleSaveWorkspace = async () => {
    if (!workspaceId) return;
    try {
      // Validate JSON
      JSON.parse(wsSettingsStr);
      await invoke("workspace_update", {
        request: {
          id: workspaceId,
          settings: wsSettingsStr,
        },
      });
      updateWorkspace(workspaceId, { settings: wsSettingsStr });
      setError(null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError("Workspace Settings Invalid JSON: " + msg);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2 text-text-main font-black border-b border-border-muted/5 pb-2 uppercase text-[10px] tracking-widest bg-bg-base/20 px-2 py-1.5 rounded-sm">
        <Settings className="w-3.5 h-3.5 text-primary shadow-glow" />
        <span>Cascading Config / 配置级联</span>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-2 bg-red-500/10 border border-red-500/20 rounded text-red-400 text-xs">
          <AlertCircle className="w-3 h-3" />
          <span>{error}</span>
        </div>
      )}

      {/* Workspace Level */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label className="text-[10px] text-text-muted/60 uppercase tracking-widest font-bold">
            Workspace Settings (JSON)
          </label>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSaveWorkspace}
            className="h-6 px-2 text-[10px] text-primary hover:bg-primary/5"
          >
            <Save className="w-3 h-3 mr-1" />
            Save Ws
          </Button>
        </div>
        <textarea
          value={wsSettingsStr}
          onChange={(e) => setWsSettingsStr(e.target.value)}
          className="w-full h-24 bg-bg-base/30 border border-border-muted/10 rounded-sm p-3 text-[11px] font-mono text-text-main focus:outline-none focus:border-primary/30 transition-all focus:bg-bg-base/50 placeholder:text-text-muted/20"
          placeholder='{"BMAD-METHOD": "auto"}'
        />
      </div>

      {/* Task Level */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label className="text-[10px] text-text-muted/60 uppercase tracking-widest font-bold">
            Task Settings (JSON)
          </label>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSaveTask}
            disabled={!taskId}
            className="h-6 px-2 text-[10px] text-primary hover:bg-primary/5 disabled:opacity-50"
          >
            <Save className="w-3 h-3 mr-1" />
            Save Task
          </Button>
        </div>
        <textarea
          value={taskSettingsStr}
          onChange={(e) => setTaskSettingsStr(e.target.value)}
          disabled={!taskId}
          className="w-full h-24 bg-bg-base/30 border border-border-muted/10 rounded-sm p-3 text-[11px] font-mono text-text-main focus:outline-none focus:border-primary/30 transition-all focus:bg-bg-base/50 disabled:opacity-50 placeholder:text-text-muted/20"
          placeholder='{"BMAD-METHOD": "pure-chat"}'
        />
      </div>

      <div className="text-[10px] text-text-muted/40 italic">
        Priority: Task Settings &gt; Workspace Settings &gt; Global Config
      </div>
    </div>
  );
};
