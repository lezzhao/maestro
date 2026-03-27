import { useState } from "react";
import {
  Cpu,
  Edit3,
  RefreshCcw,
  Save,
  CheckCircle2,
  AlertCircle,
  Trash2
} from "lucide-react";
import { Button } from "../ui/button";
import { Select } from "../ui/select";
import { Input } from "../ui/input";
import { ChoiceDialog } from "../ui/choice-dialog";
import { cn } from "../../lib/utils";
import type {
  EngineConfig,
  EngineModelListState,
  EnginePreflightResult,
  EngineProfile,
} from "../../types";

interface EngineCardProps {
  id: string;
  engine: EngineConfig;
  preflight: EnginePreflightResult | undefined;
  isActive: boolean;
  activeEngineId: string;
  onSwitch: (engineId: string) => Promise<void>;
  onPreflight: (engineId: string) => Promise<unknown>;
  onSetActiveProfile: (
    engineId: string,
    profileId: string,
  ) => Promise<void>;
  onUpsertProfile: (
    engineId: string,
    profileId: string,
    profile: EngineProfile,
  ) => Promise<void>;
  onFetchModels: (
    engineId: string,
    options?: { force?: boolean },
  ) => Promise<EngineModelListState>;
  onDelete?: (engineId: string) => Promise<void>;
}

function envToText(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

function textToEnv(input: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const rawLine of input.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const pos = line.indexOf("=");
    if (pos <= 0) continue;
    const key = line.slice(0, pos).trim();
    const value = line.slice(pos + 1).trim();
    if (!key) continue;
    env[key] = value;
  }
  return env;
}

export function EngineCard({
  id,
  engine,
  preflight,
  isActive,
  onSwitch,
  onPreflight,
  onSetActiveProfile,
  onUpsertProfile,
  onFetchModels,
  onDelete,
}: EngineCardProps) {
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<EngineProfile | null>(null);
  const [envText, setEnvText] = useState("");
  const [argText, setArgText] = useState("");
  const [headlessArgText, setHeadlessArgText] = useState("");
  const [preflighting, setPreflighting] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const ok = preflight ? preflight.command_exists && preflight.auth_ok : false;
  const profileMap = engine.profiles || {};
  const profileIds = Object.keys(profileMap);
  const activeProfileId = engine.active_profile_id && profileMap[engine.active_profile_id]
    ? engine.active_profile_id
    : profileIds[0];
  const activeProfile = profileMap[activeProfileId];

  const startEdit = (pid: string) => {
    const profile = profileMap[pid];
    if (!profile) return;
    setEditingProfileId(pid);
    setDraft({ ...profile });
    setEnvText(envToText(profile.env));
    setArgText(profile.args.join(" "));
    setHeadlessArgText(profile.headless_args.join(" "));
    
    if (modelOptions.length === 0) {
      void (async () => {
        setLoadingModels(true);
        try {
          const result = await onFetchModels(id);
          setModelOptions(result.models);
        } finally {
          setLoadingModels(false);
        }
      })();
    }
  };

  const stopEdit = () => {
    setEditingProfileId(null);
    setDraft(null);
  };

  const commitEdit = async () => {
    if (!editingProfileId || !draft) return;
    setSaving(true);
    try {
      await onUpsertProfile(id, editingProfileId, {
        ...draft,
        args: argText.split(" ").filter(Boolean),
        headless_args: headlessArgText.split(" ").filter(Boolean),
        env: textToEnv(envText),
      });
      stopEdit();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={cn(
      "bg-bg-surface border border-border-muted/10 rounded-sm mb-2 transition-all",
      isActive ? "ring-1 ring-primary/30 border-primary/20 shadow-sm" : "hover:border-border-muted/30"
    )}>
      {/* List Header View */}
      <div className="px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6 flex-1 min-w-0">
          <div className={cn("p-2 rounded-sm", ok ? "bg-emerald-500/10 text-emerald-500" : "bg-amber-500/10 text-amber-500")}>
            <Cpu size={14} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-bold text-text-main truncate">{engine.display_name}</h4>
              {isActive && <span className="text-[9px] font-black uppercase text-primary px-1.5 py-0.5 bg-primary/5 rounded-[2px] border border-primary/10">Primary</span>}
              <span className={cn(
                "text-[9px] font-black uppercase px-1.5 py-0.5 rounded-[2px] border",
                activeProfile?.execution_mode === "api" 
                  ? "text-sky-500 bg-sky-500/5 border-sky-500/10" 
                  : "text-text-muted/60 bg-text-muted/5 border-text-muted/10"
              )}>
                {activeProfile?.execution_mode === "api" ? "Cloud API" : "Local CLI"}
              </span>
            </div>
            <div className="flex items-center gap-4 text-[10px] text-text-muted/60 font-mono tracking-tighter pt-0.5">
               <span className="flex items-center gap-1">
                 {ok ? <CheckCircle2 size={10} className="text-emerald-500" /> : <AlertCircle size={10} className="text-amber-500" />}
                 {ok ? "READY" : "INCOMPLETE"}
               </span>
               <span className="opacity-40">/</span>
               <span className="truncate max-w-[200px] uppercase">{activeProfile?.execution_mode === "api" ? (activeProfile?.model || "AUTO") : activeProfile?.command}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 pl-4">
           {!draft && profileIds.length > 1 && (
             <Select
              value={activeProfileId}
              options={profileIds.map(p => ({ value: p, label: p }))}
              onChange={(pid) => void onSetActiveProfile(id, pid)}
              className="h-8 w-32 px-2 bg-bg-elevated/50 border-border-muted/10 text-[10px] rounded-sm"
            />
           )}
           <button 
            onClick={async () => {
              setPreflighting(true);
              try { await onPreflight(id); } finally { setPreflighting(false); }
            }}
            className={cn("p-1.5 rounded-sm hover:bg-bg-elevated transition-all", preflighting && "animate-spin opacity-50")}
            title="Reload Status"
           >
             <RefreshCcw size={12} className="text-text-muted" />
           </button>
            <button 
                onClick={() => {
                  setShowDeleteDialog(true);
                }}
                className="p-1.5 rounded-sm hover:bg-red-500/10 hover:text-red-500 transition-all ml-1"
                title="Delete Provider"
            >
                <Trash2 size={12} className="text-text-muted/40 hover:text-red-500 transition-colors" />
            </button>

           <button 
            onClick={() => draft ? stopEdit() : startEdit(activeProfileId)}
            className="p-1.5 rounded-sm hover:bg-bg-elevated transition-all"
            title="Edit Configuration"
           >
             <Edit3 size={12} className={cn("text-text-muted", draft && "text-primary rotate-90")} />
           </button>
           <Button
              onClick={async () => {
                setSwitching(true);
                try { await onSwitch(id); } finally { setSwitching(false); }
              }}
              disabled={isActive}
              size="sm"
              className={cn(
                "h-8 rounded-sm px-5 text-[11px] font-black uppercase tracking-widest transition-all ml-2",
                isActive 
                  ? "bg-primary/10 text-primary border border-primary/10 cursor-default" 
                  : "bg-text-main text-bg-surface hover:opacity-90"
              )}
              loading={switching}
            >
              {isActive ? "Ready" : "Switch"}
            </Button>
        </div>
      </div>

      {/* Editing Drawer Inline */}
      {draft && (
        <div className="px-16 pb-6 pt-2 border-t border-border-muted/5 animate-in slide-in-from-top-2 duration-300">
           <div className="grid grid-cols-2 gap-x-8 gap-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-text-muted/60 uppercase">Base Command</label>
                <Input 
                  value={draft.command} 
                  onChange={e => setDraft({...draft, command: e.target.value})}
                  className="h-8 rounded-sm bg-bg-elevated/40 text-xs border-border-muted/10"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-text-muted/60 uppercase">Model Identifier</label>
                 <div className="flex gap-2">
                    <Select 
                      value={draft.model || "__custom__"}
                      options={[
                        { value: "", label: "Auto" },
                        ...modelOptions.map(m => ({ value: m, label: m })),
                        { value: "__custom__", label: "Custom" }
                      ]}
                      onChange={v => setDraft({...draft, model: v === "__custom__" ? draft.model : v})}
                      className="h-8 rounded-sm bg-bg-elevated/40 text-xs flex-1"
                    />
                    <button onClick={() => void onFetchModels(id, { force: true })} className="p-2 bg-bg-elevated/40 rounded-sm border border-border-muted/10 hover:bg-bg-elevated/60">
                      <RefreshCcw size={10} className={cn(loadingModels && "animate-spin")} />
                    </button>
                 </div>
              </div>
              <div className="space-y-1.5 col-span-2">
                <label className="text-[10px] font-bold text-text-muted/60 uppercase">Execution Arguments</label>
                <Input 
                  value={argText} 
                  onChange={e => setArgText(e.target.value)}
                  className="h-8 rounded-sm bg-bg-elevated/40 text-xs border-border-muted/10"
                />
              </div>
              <div className="space-y-1.5 col-span-2">
                <label className="text-[10px] font-bold text-text-muted/60 uppercase">Environment Variables</label>
                <textarea 
                  value={envText} 
                  onChange={e => setEnvText(e.target.value)}
                  className="w-full h-24 p-3 bg-bg-elevated/40 border border-border-muted/10 rounded-sm font-mono text-xs focus:ring-0 outline-none"
                />
              </div>
           </div>
           <div className="flex gap-2 mt-6">
              <Button size="sm" className="h-8 rounded-sm bg-primary text-bg-base font-black text-[10px] px-6" onClick={commitEdit} loading={saving}>
                <Save size={12} className="mr-2" /> Save Config
              </Button>
              <Button size="sm" variant="ghost" className="h-8 rounded-sm text-text-muted text-[10px]" onClick={stopEdit}>Cancel</Button>
           </div>
        </div>
      )}

      <ChoiceDialog
        open={showDeleteDialog}
        title="删除提供商"
        description={`将删除提供商“${engine.display_name}”。如果有任务正在使用它，建议先切换到其他提供商。`}
        options={[
          {
            id: "delete-provider",
            label: "确认删除",
            description: "立即移除该提供商配置。",
            variant: "destructive",
            onSelect: async () => {
              await onDelete?.(id);
            },
          },
        ]}
        cancelLabel="保留提供商"
        onClose={() => setShowDeleteDialog(false)}
      />
    </div>
  );
}
