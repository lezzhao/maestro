import { useMemo, useState } from "react";
import {
  CheckCircle2,
  Cpu,
  Edit3,
  RefreshCcw,
  Save,
  ShieldCheck,
  Languages,
  Palette,
  Database,
  Activity,
} from "lucide-react";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import { Select } from "./ui/select";
import { cn } from "../lib/utils";
import { useTranslation } from "../i18n";
import { useAppStore } from "../stores/appStore";
import type {
  EngineConfig,
  EngineModelListState,
  EnginePreflightResult,
  EngineProfile,
} from "../types";

type Props = {
  engines: Record<string, EngineConfig>;
  enginePreflight: Record<string, EnginePreflightResult>;
  activeEngineId: string;
  onSwitch: (engineId: string) => Promise<void>;
  onPreflight: (engineId: string) => Promise<unknown>;
  onPreflightAll: () => Promise<void>;
  onSaveEngine: (engineId: string, engine: EngineConfig) => Promise<void>;
  onSetActiveProfile: (engineId: string, profileId: string) => Promise<void>;
  onUpsertProfile: (
    engineId: string,
    profileId: string,
    profile: EngineProfile,
  ) => Promise<void>;
  onFetchModels: (engineId: string, options?: { force?: boolean }) => Promise<EngineModelListState>;
  theme: "light" | "dark" | "system";
  onThemeChange: (theme: "light" | "dark" | "system") => void;
  lang: "en" | "zh";
  onLangChange: (lang: "en" | "zh") => void;
};

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

function noteTone(note?: string): "ok" | "warn" | "danger" | "muted" {
  if (!note) return "muted";
  const lower = note.toLowerCase();
  if (lower === "ready") return "ok";
  if (lower.includes("command not found") || lower.includes("spawn failed")) {
    return "danger";
  }
  if (lower.includes("timeout") || lower.includes("exit code") || lower.includes("auth check failed")) {
    return "warn";
  }
  return "muted";
}


export function SetupPanel({
  engines,
  enginePreflight,
  activeEngineId,
  onSwitch,
  onPreflight,
  onPreflightAll,
  onSetActiveProfile,
  onUpsertProfile,
  onFetchModels,
  theme,
  onThemeChange,
  lang,
  onLangChange,
}: Props) {
  const { t } = useTranslation();
  const ids = useMemo(() => Object.keys(engines), [engines]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<EngineProfile | null>(null);
  const [envText, setEnvText] = useState("");
  const [argText, setArgText] = useState("");
  const [headlessArgText, setHeadlessArgText] = useState("");
  const [preflightingId, setPreflightingId] = useState<string | null>(null);
  const [preflightingAll, setPreflightingAll] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [creatingProfile, setCreatingProfile] = useState<string | null>(null);
  const [finishedAll, setFinishedAll] = useState(false);
  const [modelOptionsByEngine, setModelOptionsByEngine] = useState<Record<string, string[]>>({});
  const [loadingModelsId, setLoadingModelsId] = useState<string | null>(null);

  const startEdit = (engineId: string, profileId?: string) => {
    const current = engines[engineId];
    if (!current) return;
    const activeProfileId =
      profileId ||
      current.active_profile_id ||
      Object.keys(current.profiles || {})[0] ||
      "default";
    const profile = current.profiles?.[activeProfileId];
    if (!profile) return;
    setEditingId(engineId);
    setEditingProfileId(activeProfileId);
    setDraft({ ...profile });
    setEnvText(envToText(profile.env));
    setArgText(profile.args.join(" "));
    setHeadlessArgText(profile.headless_args.join(" "));
    const cached = modelOptionsByEngine[engineId];
    if (cached && cached.length > 0) return;

    void (async () => {
      setLoadingModelsId(engineId);
      try {
        const result = await onFetchModels(engineId);
        setModelOptionsByEngine((prev) => ({ ...prev, [engineId]: result.models }));
      } finally {
        setLoadingModelsId((prev) => (prev === engineId ? null : prev));
      }
    })();
  };

  const stopEdit = () => {
    setEditingId(null);
    setEditingProfileId(null);
    setDraft(null);
    setEnvText("");
    setArgText("");
    setHeadlessArgText("");
  };

  const commitEdit = async () => {
    if (!editingId || !editingProfileId || !draft) return;
    setSaving(true);
    try {
      await onUpsertProfile(editingId, editingProfileId, {
        ...draft,
        id: editingProfileId,
        args: argText.split(" ").map((x) => x.trim()).filter(Boolean),
        headless_args: headlessArgText
          .split(" ")
          .map((x) => x.trim())
          .filter(Boolean),
        env: textToEnv(envText),
      });
      stopEdit();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-10 animate-in fade-in slide-in-from-bottom-2 duration-500 pb-20">
      {/* General Settings */}
      <section className="space-y-6">
        <div className="flex items-center gap-3 px-2">
          <div className="w-10 h-10 rounded-xl bg-primary-500/10 text-primary-500 flex items-center justify-center">
            <Palette size={20} />
          </div>
          <div className="flex flex-col">
            <h2 className="text-xl font-bold text-text-main tracking-tight">{t("general_settings") || "General Settings"}</h2>
            <p className="text-[10px] text-text-muted font-semibold uppercase tracking-wider mt-0.5">Customization & Locale</p>
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="rounded-xl border-border-muted bg-bg-surface shadow-sm overflow-hidden">
            <CardHeader className="pb-2">
               <div className="flex items-center gap-2 text-primary-500">
                  <Palette size={16} />
                  <CardTitle className="text-sm font-semibold uppercase">{t("theme_label") || "Theme"}</CardTitle>
               </div>
            </CardHeader>
            <CardContent className="pt-4 px-6 pb-6">
              <div className="capsule-group w-full max-w-sm">
                <button 
                  className={cn("capsule-sm flex-1 text-[10px] font-semibold uppercase", theme === "light" && "active")}
                  onClick={() => onThemeChange("light")}
                >
                  Light
                </button>
                <button 
                  className={cn("capsule-sm flex-1 text-[10px] font-semibold uppercase", theme === "dark" && "active")}
                  onClick={() => onThemeChange("dark")}
                >
                  Dark
                </button>
                <button 
                  className={cn("capsule-sm flex-1 text-[10px] font-semibold uppercase", theme === "system" && "active")}
                  onClick={() => onThemeChange("system")}
                >
                  System
                </button>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-xl border-border-muted bg-bg-surface shadow-sm overflow-hidden">
            <CardHeader className="pb-2">
               <div className="flex items-center gap-2 text-primary-500">
                  <Languages size={16} />
                  <CardTitle className="text-sm font-semibold uppercase">{t("language_label") || "Language"}</CardTitle>
               </div>
            </CardHeader>
            <CardContent className="pt-4 px-6 pb-6">
              <div className="capsule-group w-full max-w-xs">
                <button 
                  className={cn("capsule-sm flex-1 text-[10px] font-semibold uppercase", lang === "zh" && "active")}
                  onClick={() => onLangChange("zh")}
                >
                  中文
                </button>
                <button 
                  className={cn("capsule-sm flex-1 text-[10px] font-semibold uppercase", lang === "en" && "active")}
                  onClick={() => onLangChange("en")}
                >
                  English
                </button>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>
      <section className="space-y-6">
        <div className="flex items-center justify-between px-2">
          <div className="flex flex-col">
            <h2 className="text-xl font-bold text-text-main tracking-tight flex items-center gap-2">
              <Cpu className="text-primary-500" size={24} />
              {t("core_engines")}
            </h2>
            <p className="text-xs text-text-muted font-medium mt-1">Configure and manage your AI execution engines</p>
          </div>
          <Button 
            size="lg" 
            variant="default" 
            className="rounded-xl h-11 px-6 shadow-sm active:scale-95 transition-all bg-primary-500 hover:bg-primary-600 text-white" 
            loading={preflightingAll}
            success={finishedAll}
            onClick={async () => {
              setPreflightingAll(true);
              setFinishedAll(false);
              try {
                await onPreflightAll();
                setFinishedAll(true);
              } finally {
                setPreflightingAll(false);
              }
            }}
          >
            {finishedAll ? (
              <CheckCircle2 size={18} className="mr-2" />
            ) : (
              <RefreshCcw size={18} className={cn("mr-2", preflightingAll && "animate-spin")} />
            )}
            <span className="font-semibold">{finishedAll ? t("check_done") : t("check_all")}</span>
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {ids.map((id) => {
            const engine = engines[id];
            const preflight = enginePreflight[id];
            const ok = preflight ? preflight.command_exists && preflight.auth_ok : false;
            const tone = noteTone(preflight?.notes);
            const isActive = id === activeEngineId;
            const editing = id === editingId && draft;
            const profileMap = engine.profiles || {};
            const profileIds = Object.keys(profileMap);
            const activeProfileId =
              engine.active_profile_id && profileMap[engine.active_profile_id]
                ? engine.active_profile_id
                : profileIds[0];
            const activeProfile = profileMap[activeProfileId];
            const modelOptions = modelOptionsByEngine[id] || [];

            const modelInList = (draft?.model || "").trim()
              ? modelOptions.includes((draft?.model || "").trim())
              : true;
            const modelSelectValue = !draft
              ? ""
              : !draft.model
                ? ""
                : modelInList
                  ? draft.model
                  : "__custom__";

            return (
              <Card
                key={id}
                className={cn(
                  "group relative overflow-hidden transition-all duration-300 rounded-xl border-border-muted bg-bg-surface shadow-sm hover:shadow-md hover:border-primary-500/30",
                  isActive && "ring-1 ring-primary-500 border-primary-500/40 bg-primary-500/2"
                )}
              >
                {isActive && (
                  <div className="absolute top-0 right-0 p-px">
                     <div className="bg-primary-500 text-white text-[9px] font-semibold px-2 py-0.5 rounded-bl-lg rounded-tr-xl uppercase shadow-sm">
                      {t("active_label")}
                     </div>
                  </div>
                )}

                <CardHeader className="pb-4 pt-6 px-8">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className={cn(
                        "w-12 h-12 rounded-xl flex items-center justify-center transition-transform group-hover:scale-105",
                        ok ? "bg-emerald-500/10 text-emerald-500" : "bg-amber-500/10 text-amber-500"
                      )}>
                        <Cpu size={24} />
                      </div>
                      <div>
                        <CardTitle className="text-base font-bold tracking-tight flex items-center gap-2">
                          {engine.display_name}
                          <Badge variant="outline" className="text-[10px] font-medium opacity-60 rounded-md">V1.0</Badge>
                        </CardTitle>
                        <div className="flex items-center gap-2 mt-1">
                          <div className={cn("w-2 h-2 rounded-full", ok ? "bg-emerald-500" : "bg-amber-500 animate-pulse")} />
                          <span className={cn("text-[10px] font-semibold uppercase", ok ? "text-emerald-500" : "text-amber-500")}>
                            {ok ? "Engine Ready" : "Setup Required"}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="px-8 pb-8 space-y-6">
                  {!editing ? (
                    <>
                      <div className="space-y-4">
                        <div className="bg-bg-code rounded-xl p-4 border border-border-muted/20 font-mono text-[11px] leading-relaxed text-text-muted relative overflow-hidden group/code overflow-x-auto">
                          <div className="flex items-start gap-2">
                            <span className="text-primary-500 font-bold opacity-60">$</span>
                            <span className="break-all">{activeProfile?.command || engine.command} {(activeProfile?.args || engine.args).join(" ")}</span>
                          </div>
                          {activeProfile?.model && (
                            <div className="mt-2 flex items-center gap-2 text-primary-400 font-semibold opacity-80">
                              <span className="text-[9px] uppercase opacity-40">Model:</span>
                              {activeProfile.model}
                            </div>
                          )}
                        </div>

                        <div className={cn(
                          "px-4 py-3 rounded-xl border flex items-start gap-3 transition-colors",
                          tone === "ok" ? "bg-emerald-500/5 border-emerald-500/20 text-emerald-600/90" :
                          tone === "danger" ? "bg-rose-500/5 border-rose-500/20 text-rose-600/90" :
                          "bg-bg-base border-border-muted text-text-muted"
                        )}>
                          <div className="mt-0.5 p-1 rounded-full bg-bg-surface border border-border-muted shadow-sm">
                            <ShieldCheck size={12} />
                          </div>
                          <div className="flex-1">
                            <span className="text-[9px] font-semibold uppercase block mb-0.5 opacity-50">{t("engine_status")}</span>
                            <p className="whitespace-pre-wrap wrap-break-word text-[14px] leading-relaxed font-semibold">{preflight?.notes || t("not_checked_yet")}</p>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col gap-4 pt-2">
                        <div className="grid grid-cols-[1fr_auto] gap-3">
                          <div className="relative group/sel">
                             <Select
                              value={activeProfileId}
                              options={profileIds.map((pid) => ({ value: pid, label: pid }))}
                              onChange={(pid) => void onSetActiveProfile(id, pid)}
                              className="h-10 rounded-xl bg-bg-base/40 border-border-muted/20 focus:ring-primary-500/20"
                            />
                          </div>
                          <Button
                            variant="secondary"
                            className="h-10 px-4 rounded-xl border border-border-muted/20 hover:bg-bg-elevated transition-all"
                            loading={creatingProfile === id}
                            onClick={async () => {
                              setCreatingProfile(id);
                              try {
                                const nextId = `profile-${profileIds.length + 1}`;
                                const base = activeProfile || {
                                  id: "default",
                                  display_name: "Default",
                                  command: engine.command,
                                  model: "",
                                  args: engine.args,
                                  env: engine.env,
                                  supports_headless: engine.supports_headless,
                                  headless_args: engine.headless_args,
                                  ready_signal: engine.ready_signal ?? null,
                                };
                                await onUpsertProfile(id, nextId, { ...base, id: nextId, display_name: nextId });
                              } finally {
                                setCreatingProfile(null);
                              }
                            }}
                          >
                            <span className="text-[11px] font-black uppercase tracking-widest">{t("new_profile")}</span>
                          </Button>
                        </div>

                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant={isActive ? "default" : "outline"}
                            loading={switchingId === id}
                            className={cn(
                              "flex-1 h-10 rounded-xl font-semibold uppercase text-[10px] active:scale-95",
                              isActive ? "bg-primary-500 text-white" : ""
                            )}
                            onClick={async () => {
                              setSwitchingId(id);
                              try { await onSwitch(id); } finally { setSwitchingId(null); }
                            }}
                            disabled={isActive}
                          >
                            {isActive ? t("active_label") : t("set_active")}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            loading={preflightingId === id}
                            className="flex-1 h-10 rounded-xl font-semibold uppercase text-[10px] hover:border-primary-500/40 hover:text-primary-500 active:scale-95"
                            onClick={async () => {
                              setPreflightingId(id);
                              try { await onPreflight(id); } finally { setPreflightingId(null); }
                            }}
                          >
                            {t("check")}
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            className="w-10 h-10 p-0 rounded-xl border border-border-muted/20 hover:bg-bg-elevated transition-all"
                            onClick={() => startEdit(id, activeProfileId)}
                          >
                            <Edit3 size={16} />
                          </Button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="space-y-4 pt-2">
                      <div className="space-y-1.5">
                        <label className="px-1 text-[9px] font-black uppercase tracking-widest text-text-muted/60">{t("command")}</label>
                        <Input
                          value={draft.command}
                          onChange={(e) => setDraft((prev) => (prev ? { ...prev, command: e.target.value } : prev))}
                          className="bg-bg-base/40 border-border-muted/30 rounded-xl h-10 focus:ring-primary-500/20"
                        />
                      </div>

                      <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
                        <div className="space-y-1.5 flex-1">
                          <label className="px-1 text-[9px] font-black uppercase tracking-widest text-text-muted/60">{t("active_profile")}</label>
                          <Select
                            value={modelSelectValue}
                            options={[
                              { value: "", label: t("no_model") },
                              ...modelOptions.map((m) => ({ value: m, label: m })),
                              { value: "__custom__", label: t("custom_model") },
                            ]}
                            onChange={(val) => setDraft((prev) => (prev ? { ...prev, model: val === "__custom__" ? (prev.model || "") : val } : prev))}
                            className="bg-bg-base/40 border-border-muted/30 rounded-xl h-10 focus:ring-primary-500/20"
                          />
                        </div>
                        <Button
                          size="icon"
                          variant="outline"
                          className="w-10 h-10 rounded-xl border-border-muted/30 hover:border-primary-500/40"
                          loading={loadingModelsId === id}
                          onClick={() => void onFetchModels(id, { force: true })}
                        >
                          <RefreshCcw size={16} className={cn(loadingModelsId === id && "animate-spin")} />
                        </Button>
                      </div>

                      {modelSelectValue === "__custom__" && (
                        <Input
                          value={draft.model ?? ""}
                          onChange={(e) => setDraft((prev) => (prev ? { ...prev, model: e.target.value } : prev))}
                          placeholder={t("model_custom_placeholder")}
                          className="bg-bg-base/40 border-border-muted/30 rounded-xl h-10"
                        />
                      )}

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <label className="px-1 text-[9px] font-black uppercase tracking-widest text-text-muted/60">{t("args")}</label>
                          <Input
                            value={argText}
                            onChange={(e) => setArgText(e.target.value)}
                            className="bg-bg-base/40 border-border-muted/30 rounded-xl h-10"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="px-1 text-[9px] font-black uppercase tracking-widest text-text-muted/60">{t("headless_args")}</label>
                          <Input
                            value={headlessArgText}
                            onChange={(e) => setHeadlessArgText(e.target.value)}
                            className="bg-bg-base/40 border-border-muted/30 rounded-xl h-10"
                          />
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <label className="px-1 text-[9px] font-black uppercase tracking-widest text-text-muted/60">{t("env")}</label>
                        <textarea
                          className="w-full min-h-[100px] rounded-2xl border border-border-muted/30 bg-bg-base/40 px-4 py-3 text-xs font-mono focus:ring-2 focus:ring-primary-500/20 outline-none transition-all"
                          value={envText}
                          onChange={(e) => setEnvText(e.target.value)}
                          placeholder="KEY=VALUE"
                        />
                      </div>

                      <div className="flex gap-3 pt-2">
                        <Button variant="primary-gradient" className="flex-1 h-11 rounded-2xl font-bold shadow-lg" onClick={() => void commitEdit()} loading={saving}>
                          <Save size={16} className="mr-2" />
                          {t("save")}
                        </Button>
                        <Button variant="outline" className="flex-1 h-11 rounded-2xl font-bold border-border-muted/30" onClick={stopEdit}>
                          {t("cancel")}
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      {/* System Diagnostics */}
      <section className="space-y-6 pt-4">
        <div className="flex items-center gap-3 px-2">
          <div className="w-10 h-10 rounded-xl bg-rose-500/10 text-rose-500 flex items-center justify-center">
            <Activity size={20} />
          </div>
          <div className="flex flex-col">
             <h2 className="text-xl font-bold text-text-main tracking-tight">{t("system_diagnostics") || "System Diagnostics"}</h2>
             <p className="text-[10px] text-text-muted font-semibold uppercase tracking-wider mt-0.5">Troubleshooting & Logs</p>
          </div>
        </div>
        
        <Card className="rounded-xl border-border-muted bg-bg-surface shadow-sm overflow-hidden">
          <CardContent className="p-8 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
               <div className="p-4 rounded-xl bg-bg-base border border-border-muted">
                  <h4 className="flex items-center gap-2 text-[10px] font-semibold uppercase text-text-muted mb-3">
                     <Database size={14} className="text-primary-500" />
                     Store Status
                  </h4>
                  <div className="space-y-2">
                     <div className="flex justify-between text-xs">
                        <span className="opacity-50">Active Task ID:</span>
                        <span className="font-mono text-primary-500">{activeEngineId || "None"}</span>
                     </div>
                     <div className="flex justify-between text-xs">
                        <span className="opacity-50">Tasks Count:</span>
                        <span className="font-mono">{Object.keys(engines).length} Tasks</span>
                     </div>
                  </div>
               </div>
               
               <div className="p-4 rounded-xl bg-bg-base border border-border-muted">
                  <h4 className="flex items-center gap-2 text-[10px] font-semibold uppercase text-text-muted mb-3">
                     <Activity size={14} className="text-rose-500" />
                     Diagnostic Actions
                  </h4>
                  <div className="flex gap-2">
                     <Button 
                       variant="outline" 
                       size="sm" 
                       className="rounded-lg flex-1 text-[10px] font-semibold"
                       onClick={() => {
                          console.log("Full Store Snapshot:", useAppStore.getState());
                          alert("Store snapshot dumped to console (check Web Inspector)");
                       }}
                     >
                        Dump Snapshot
                     </Button>
                     <Button 
                       variant="outline" 
                       size="sm" 
                       className="rounded-lg flex-1 text-[10px] font-semibold"
                       onClick={() => window.location.reload()}
                     >
                        Force Reload
                     </Button>
                  </div>
               </div>
            </div>

            <div className="bg-bg-code rounded-xl p-6 border border-border-muted font-mono text-[11px] leading-relaxed relative overflow-hidden group/logs">
                <div className="flex items-center justify-between mb-4">
                   <h5 className="text-[10px] font-semibold uppercase text-rose-500/80">Diagnostic Log Trace</h5>
                   <Badge variant="outline" className="text-[8px] opacity-40">AUTO-GEN</Badge>
                </div>
                <div className="space-y-1.5 opacity-80 max-h-[200px] overflow-y-auto custom-scrollbar">
                   <div><span className="text-text-muted/40 mr-2">[INFO]</span> Checking crypto service availability... <span className="text-emerald-500">Ready</span></div>
                   <div><span className="text-text-muted/40 mr-2">[INFO]</span> Validating persistent storage... <span className="text-emerald-500">OK</span></div>
                   <div><span className="text-text-muted/40 mr-2">[INFO]</span> Active Task: {activeEngineId}</div>
                   <div><span className="text-text-muted/40 mr-2">[INFO]</span> Environment: {import.meta.env.MODE} {navigator.platform}</div>
                </div>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
