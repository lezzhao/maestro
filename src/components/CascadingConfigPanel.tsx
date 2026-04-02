import React, { useState, useEffect } from "react";
import { Settings, Save, AlertCircle } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import {
  useTaskStoreState,
  useWorkspaceStoreState,
} from "../hooks/use-app-store-selectors";
import { updateTaskCommand } from "../hooks/commands/task-commands";
import { updateWorkspaceCommand } from "../hooks/commands/workspace-commands";
import { Button } from "./ui/button";

interface CascadingConfigPanelProps {
  taskId: string | null;
  workspaceId: string | null;
}

interface BuiltinRole {
  id: string;
  label: string;
  prompt: string;
}

interface SettingsObject {
  system_prompt?: string;
  [key: string]: unknown;
}

interface ConfigLevelSectionProps {
  title: string;
  settings: SettingsObject;
  rawJson: string;
  builtinRoles: BuiltinRole[];
  onFieldUpdate: <K extends keyof SettingsObject>(key: K, value: SettingsObject[K]) => void;
  onRawJsonChange: (value: string) => void;
  onSave: () => void;
  disabled?: boolean;
  isTaskLevel?: boolean;
}

const QuickRoleSelector: React.FC<{
  roles: BuiltinRole[];
  currentPrompt: string;
  onSelect: (prompt: string) => void;
  disabled?: boolean;
}> = ({ roles, currentPrompt, onSelect, disabled }) => {
  return (
    <div className="flex flex-wrap gap-1.5 mb-2">
      {roles.map((role) => (
        <button
          key={role.id}
          disabled={disabled}
          onClick={() => onSelect(role.prompt)}
          className={`px-2 py-0.5 rounded-full text-[9px] font-bold border transition-all ${
            currentPrompt === role.prompt
              ? "bg-primary/20 border-primary/50 text-primary shadow-glow-sm"
              : "bg-bg-base/20 border-border-muted/10 text-text-muted/60 hover:border-primary/30 hover:text-text-main"
          } disabled:opacity-30 disabled:pointer-events-none`}
        >
          {role.label}
        </button>
      ))}
      {currentPrompt && (
        <button
          disabled={disabled}
          onClick={() => onSelect("")}
          className="px-2 py-0.5 rounded-full text-[8px] font-bold bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-all uppercase tracking-tighter disabled:opacity-30"
        >
          Clear
        </button>
      )}
    </div>
  );
};

const ConfigLevelSection: React.FC<ConfigLevelSectionProps> = ({
  title,
  settings,
  rawJson,
  builtinRoles,
  onFieldUpdate,
  onRawJsonChange,
  onSave,
  disabled,
  isTaskLevel,
}) => {
  return (
    <div className="flex flex-col gap-4 p-3 bg-bg-base/10 border border-border-muted/5 rounded-md shadow-sm">
      <div className="flex items-center justify-between">
        <label className="text-[10px] text-text-muted/80 uppercase tracking-widest font-black flex items-center gap-2">
          <div className={`w-1.5 h-1.5 rounded-full ${isTaskLevel ? "bg-primary shadow-glow" : "bg-primary/40 shadow-glow-sm"}`} />
          {title}
        </label>
        <Button
          variant="ghost"
          size="sm"
          onClick={onSave}
          disabled={disabled}
          className="h-6 px-2 text-[10px] text-primary hover:bg-primary/5 disabled:opacity-50 font-bold uppercase tracking-tighter transition-all"
        >
          <Save className="w-3 h-3 mr-1" />
          Apply {isTaskLevel ? "Task" : "Ws"}
        </Button>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[9px] text-text-muted/40 uppercase font-bold tracking-tighter">
          System Prompt / 角色赋予 {isTaskLevel && "(Overrides Workspace)"}
        </span>
        <QuickRoleSelector
          roles={builtinRoles}
          currentPrompt={settings.system_prompt || ""}
          onSelect={(p) => onFieldUpdate("system_prompt", p)}
          disabled={disabled}
        />
        <textarea
          value={settings.system_prompt || ""}
          onChange={(e) => onFieldUpdate("system_prompt", e.target.value)}
          disabled={disabled}
          className="w-full h-20 bg-bg-base/20 border border-border-muted/10 rounded-sm p-2 text-[11px] text-text-main focus:outline-none focus:border-primary/30 transition-all focus:bg-bg-base/40 disabled:opacity-50 placeholder:text-text-muted/10"
          placeholder="e.g. You are a senior specialist..."
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[9px] text-text-muted/40 uppercase font-bold tracking-tighter">
          Custom Settings (JSON)
        </span>
        <textarea
          value={rawJson}
          onChange={(e) => onRawJsonChange(e.target.value)}
          disabled={disabled}
          className="w-full h-20 bg-bg-base/20 border border-border-muted/10 rounded-sm p-2 text-[10px] font-mono text-text-main focus:outline-none focus:border-primary/30 transition-all focus:bg-bg-base/40 disabled:opacity-50 placeholder:text-text-muted/10"
          placeholder='{"KEY": "VALUE"}'
        />
      </div>
    </div>
  );
};

export const CascadingConfigPanel: React.FC<CascadingConfigPanelProps> = ({
  taskId,
  workspaceId,
}) => {
  const { tasks, updateTaskRecord } = useTaskStoreState();
  const { workspaces, updateWorkspace } = useWorkspaceStoreState();

  const activeTask = tasks.find((t) => t.id === taskId);
  const activeWs = workspaces.find((w) => w.id === workspaceId);

  const [wsSettings, setWsSettings] = useState<SettingsObject>({});
  const [taskSettings, setTaskSettings] = useState<SettingsObject>({});
  const [wsRawJson, setWsRawJson] = useState("{}");
  const [taskRawJson, setTaskRawJson] = useState("{}");

  const [error, setError] = useState<string | null>(null);
  const [builtinRoles, setBuiltinRoles] = useState<BuiltinRole[]>([]);

  useEffect(() => {
    invoke<BuiltinRole[]>("get_builtin_roles")
      .then(setBuiltinRoles)
      .catch(console.error);
  }, []);

  // Initialize Workspace from Store
  useEffect(() => {
    if (activeWs?.settings) {
      try {
        const parsed = JSON.parse(activeWs.settings);
        setWsSettings(parsed);
        setWsRawJson(JSON.stringify(parsed, null, 2));
      } catch {
        setWsRawJson(activeWs.settings);
      }
    } else {
      setWsSettings({});
      setWsRawJson("{}");
    }
  }, [activeWs?.id, activeWs?.settings]);

  // Initialize Task from Store
  useEffect(() => {
    if (activeTask?.id) {
      if (activeTask.settings) {
        try {
          const parsed = JSON.parse(activeTask.settings);
          setTaskSettings(parsed);
          setTaskRawJson(JSON.stringify(parsed, null, 2));
        } catch {
          setTaskRawJson(activeTask.settings);
        }
      } else {
        setTaskSettings({});
        setTaskRawJson("{}");
      }
    }
  }, [activeTask?.id, activeTask?.settings]);

  // Unified Update Logic
  const createFieldUpdater = (
    settings: SettingsObject,
    setSettings: React.Dispatch<React.SetStateAction<SettingsObject>>,
    setRawJson: React.Dispatch<React.SetStateAction<string>>
  ) => <K extends keyof SettingsObject>(key: K, value: SettingsObject[K]) => {
    const next = { ...settings, [key]: value };
    if (!value && key in next) delete next[key];
    setSettings(next);
    setRawJson(JSON.stringify(next, null, 2));
  };

  const createJsonHandler = (
    setSettings: React.Dispatch<React.SetStateAction<SettingsObject>>,
    setRawJson: React.Dispatch<React.SetStateAction<string>>
  ) => (val: string) => {
    setRawJson(val);
    try {
      const parsed = JSON.parse(val);
      setSettings(parsed);
      setError(null);
    } catch {
      // Allow drafting invalid JSON
    }
  };

  const updateWsField = createFieldUpdater(wsSettings, setWsSettings, setWsRawJson);
  const updateTaskField = createFieldUpdater(taskSettings, setTaskSettings, setTaskRawJson);
  const onWsRawJsonChange = createJsonHandler(setWsSettings, setWsRawJson);
  const onTaskRawJsonChange = createJsonHandler(setTaskSettings, setTaskRawJson);

  const handleSaveWorkspace = async () => {
    if (!workspaceId) return;
    try {
      JSON.parse(wsRawJson);
      await updateWorkspaceCommand({ id: workspaceId, settings: wsRawJson });
      updateWorkspace(workspaceId, { settings: wsRawJson });
      setError(null);
    } catch (e: unknown) {
      setError("Workspace Settings Invalid JSON: " + (e instanceof Error ? e.message : String(e)));
    }
  };

  const handleSaveTask = async () => {
    if (!taskId) return;
    try {
      JSON.parse(taskRawJson);
      await updateTaskCommand({ id: taskId, settings: taskRawJson });
      updateTaskRecord(taskId, { settings: taskRawJson });
      setError(null);
    } catch (e: unknown) {
      setError("Task Settings Invalid JSON: " + (e instanceof Error ? e.message : String(e)));
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2 text-text-main font-black border-b border-border-muted/5 pb-2 uppercase text-[10px] tracking-widest bg-bg-base/20 px-2 py-1.5 rounded-sm">
        <Settings className="w-3.5 h-3.5 text-primary shadow-glow" />
        <span>Cascading Config / 配置级联</span>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-2 bg-red-500/10 border border-red-500/20 rounded text-red-400 text-xs animate-in fade-in slide-in-from-top-1">
          <AlertCircle className="w-3 h-3" />
          <span>{error}</span>
        </div>
      )}

      {/* Workspace Level */}
      <ConfigLevelSection
        title="Workspace Level / 工作空间级"
        settings={wsSettings}
        rawJson={wsRawJson}
        builtinRoles={builtinRoles}
        onFieldUpdate={updateWsField}
        onRawJsonChange={onWsRawJsonChange}
        onSave={handleSaveWorkspace}
        disabled={!workspaceId}
      />

      {/* Task Level */}
      <ConfigLevelSection
        title="Task Level / 任务级"
        settings={taskSettings}
        rawJson={taskRawJson}
        builtinRoles={builtinRoles}
        onFieldUpdate={updateTaskField}
        onRawJsonChange={onTaskRawJsonChange}
        onSave={handleSaveTask}
        disabled={!taskId}
        isTaskLevel
      />

      <div className="flex items-center gap-2 text-[9px] text-text-muted/30 uppercase font-bold px-2 italic">
        <div className="w-1 h-1 bg-text-muted/20 rounded-full" />
        <span>Override Priority: Task &gt; Workspace &gt; Global</span>
      </div>
    </div>
  );
};
