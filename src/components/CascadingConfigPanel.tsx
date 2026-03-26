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
    <div className="flex flex-col gap-6 p-4 bg-slate-900/50 rounded-lg border border-slate-700/50">
      <div className="flex items-center gap-2 text-slate-200 font-medium border-b border-slate-700/50 pb-2">
        <Settings className="w-4 h-4 text-blue-400" />
        <span>Cascading Config</span>
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
          <label className="text-xs text-slate-400 uppercase tracking-wider font-semibold">
            Workspace Settings (JSON)
          </label>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSaveWorkspace}
            className="h-6 px-2 text-[10px] text-blue-400 hover:text-blue-300"
          >
            <Save className="w-3 h-3 mr-1" />
            Save Ws
          </Button>
        </div>
        <textarea
          value={wsSettingsStr}
          onChange={(e) => setWsSettingsStr(e.target.value)}
          className="w-full h-24 bg-slate-950 border border-slate-800 rounded p-2 text-xs font-mono text-slate-300 focus:outline-none focus:border-blue-500/50 transition-colors"
          placeholder='{"BMAD-METHOD": "auto"}'
        />
      </div>

      {/* Task Level */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label className="text-xs text-slate-400 uppercase tracking-wider font-semibold">
            Task Settings (JSON)
          </label>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSaveTask}
            disabled={!taskId}
            className="h-6 px-2 text-[10px] text-blue-400 hover:text-blue-300 disabled:opacity-50"
          >
            <Save className="w-3 h-3 mr-1" />
            Save Task
          </Button>
        </div>
        <textarea
          value={taskSettingsStr}
          onChange={(e) => setTaskSettingsStr(e.target.value)}
          disabled={!taskId}
          className="w-full h-24 bg-slate-950 border border-slate-800 rounded p-2 text-xs font-mono text-slate-300 focus:outline-none focus:border-blue-500/50 transition-colors disabled:opacity-50"
          placeholder='{"BMAD-METHOD": "pure-chat"}'
        />
      </div>

      <div className="text-[10px] text-slate-500 italic">
        Priority: Task Settings &gt; Workspace Settings &gt; Global Config
      </div>
    </div>
  );
};
