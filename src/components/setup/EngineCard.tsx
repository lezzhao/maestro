import { useState } from "react";
import {
  Cpu,
  Edit3,
  RefreshCcw,
  Save,
  ShieldCheck,
} from "lucide-react";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Input } from "../ui/input";
import { Badge } from "../ui/badge";
import { Select } from "../ui/select";
import { cn } from "../../lib/utils";
import { useTranslation } from "../../i18n";
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
}

/** 将环境变量对象序列化为多行文本 */
function envToText(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

/** 将多行文本解析为环境变量对象 */
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

/** 根据预检结果返回语义色调 */
function noteTone(note?: string): "ok" | "warn" | "danger" | "muted" {
  if (!note) return "muted";
  const lower = note.toLowerCase();
  if (lower === "ready") return "ok";
  if (
    lower.includes("command not found") ||
    lower.includes("spawn failed")
  ) {
    return "danger";
  }
  if (
    lower.includes("timeout") ||
    lower.includes("exit code") ||
    lower.includes("auth check failed")
  ) {
    return "warn";
  }
  return "muted";
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
}: EngineCardProps) {
  const { t } = useTranslation();

  // 编辑态内部状态
  const [editingProfileId, setEditingProfileId] = useState<string | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<EngineProfile | null>(null);
  const [envText, setEnvText] = useState("");
  const [argText, setArgText] = useState("");
  const [headlessArgText, setHeadlessArgText] = useState("");
  const [preflighting, setPreflighting] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [creatingProfile, setCreatingProfile] = useState(false);
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  const editing = draft !== null;

  const ok = preflight
    ? preflight.command_exists && preflight.auth_ok
    : false;
  const tone = noteTone(preflight?.notes);
  const profileMap = engine.profiles || {};
  const profileIds = Object.keys(profileMap);
  const activeProfileId =
    engine.active_profile_id && profileMap[engine.active_profile_id]
      ? engine.active_profile_id
      : profileIds[0];
  const activeProfile = profileMap[activeProfileId];

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

  const startEdit = (profileId?: string) => {
    const pid =
      profileId ||
      engine.active_profile_id ||
      Object.keys(engine.profiles || {})[0] ||
      "default";
    const profile = profileMap[pid];
    if (!profile) return;
    setEditingProfileId(pid);
    setDraft({ ...profile });
    setEnvText(envToText(profile.env));
    setArgText(profile.args.join(" "));
    setHeadlessArgText(profile.headless_args.join(" "));

    // 拉取模型列表（如果尚无缓存）
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
    setEnvText("");
    setArgText("");
    setHeadlessArgText("");
  };

  const commitEdit = async () => {
    if (!editingProfileId || !draft) return;
    setSaving(true);
    try {
      await onUpsertProfile(id, editingProfileId, {
        ...draft,
        id: editingProfileId,
        execution_mode: draft.execution_mode || "cli",
        api_provider: draft.api_provider || null,
        api_base_url: draft.api_base_url || null,
        api_key: draft.api_key || null,
        args: argText
          .split(" ")
          .map((x) => x.trim())
          .filter(Boolean),
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
    <Card
      className={cn(
        "group relative overflow-hidden transition-all duration-200 rounded-xl border border-border bg-bg-surface",
        isActive &&
          "ring-1 ring-primary-500 border-primary-500",
      )}
    >
      {isActive && (
        <div className="absolute top-0 right-0 p-px">
          <div className="bg-primary-500 text-white text-xs px-2 py-0.5 rounded-bl-lg rounded-tr-xl shadow-sm">
            {t("active_label")}
          </div>
        </div>
      )}

      <CardHeader className="pb-4 pt-6 px-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div
              className={cn(
                "w-10 h-10 rounded-lg flex items-center justify-center",
                ok
                  ? "bg-bg-elevated text-text-main"
                  : "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-500",
              )}
            >
              <Cpu size={20} />
            </div>
            <div>
              <CardTitle className="text-base font-bold tracking-tight flex items-center gap-2">
                {engine.display_name}
                <Badge
                  variant="outline"
                  className="font-medium bg-transparent"
                >
                  V1.0
                </Badge>
              </CardTitle>
              <div className="flex items-center gap-2 mt-1">
                <div
                  className={cn(
                    "w-2 h-2 rounded-full",
                    ok ? "bg-emerald-500" : "bg-amber-500",
                  )}
                />
                <span
                  className={cn(
                    "text-xs font-medium",
                    ok ? "text-text-muted" : "text-amber-600 dark:text-amber-500",
                  )}
                >
                  {ok ? "Ready" : "Setup Required"}
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
              <div className="bg-bg-code rounded-lg p-3 border border-border text-sm font-mono text-text-muted relative overflow-x-auto">
                <div className="flex items-start gap-2">
                  <span className="text-primary-500 font-bold opacity-80">
                    $
                  </span>
                  <span className="break-all text-text-main">
                    {activeProfile?.command || engine.command}{" "}
                    {(activeProfile?.args || engine.args).join(" ")}
                  </span>
                </div>
                {activeProfile?.model && (
                  <div className="mt-2 flex items-center gap-2 text-text-muted">
                    <span className="text-xs opacity-60">
                      Model:
                    </span>
                    <span className="font-semibold text-text-main">{activeProfile.model}</span>
                  </div>
                )}
                <div className="mt-1 flex items-center gap-2 text-xs">
                  <span className="opacity-60">Mode:</span>
                  <span className="font-semibold text-text-main">
                    {(activeProfile?.execution_mode || "cli").toUpperCase()}
                  </span>
                </div>
              </div>

              <div
                className={cn(
                  "px-4 py-3 rounded-md border flex items-start gap-3",
                  tone === "ok"
                    ? "bg-bg-elevated border-border text-text-main"
                    : tone === "danger"
                      ? "bg-rose-50 border-rose-200 text-rose-700 dark:bg-rose-500/10 dark:border-rose-500/20 dark:text-rose-400"
                      : "bg-bg-base border-border text-text-muted",
                )}
              >
                <div className="mt-0.5 text-text-muted">
                  <ShieldCheck size={16} />
                </div>
                <div className="flex-1">
                  <span className="text-xs font-semibold block mb-0.5 opacity-70">
                    {t("engine_status")}
                  </span>
                  <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                    {preflight?.notes || t("not_checked_yet")}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-4 pt-2">
              <div className="grid grid-cols-[1fr_auto] gap-3">
                <div className="relative group/sel">
                  <Select
                    value={activeProfileId}
                    options={profileIds.map((pid) => ({
                      value: pid,
                      label: pid,
                    }))}
                    onChange={(pid) => void onSetActiveProfile(id, pid)}
                    className="h-10 rounded-md bg-bg-base border-border-muted focus:ring-primary-500/20"
                  />
                </div>
                <Button
                  variant="secondary"
                  className="h-10 px-4 rounded-md border border-border-muted hover:bg-bg-elevated transition-all"
                  loading={creatingProfile}
                  onClick={async () => {
                    setCreatingProfile(true);
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
                        execution_mode: engine.execution_mode || "cli",
                        api_provider: engine.api_provider ?? null,
                        api_base_url: engine.api_base_url ?? null,
                        api_key: engine.api_key ?? null,
                      };
                      await onUpsertProfile(id, nextId, {
                        ...base,
                        id: nextId,
                        display_name: nextId,
                      });
                    } finally {
                      setCreatingProfile(false);
                    }
                  }}
                >
                  <span className="font-medium text-xs">
                    {t("new_profile")}
                  </span>
                </Button>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant={isActive ? "default" : "outline"}
                  loading={switching}
                  className={cn(
                    "flex-1 rounded-md text-xs",
                    isActive ? "bg-primary-500 hover:bg-primary-600 text-white" : "",
                  )}
                  onClick={async () => {
                    setSwitching(true);
                    try {
                      await onSwitch(id);
                    } finally {
                      setSwitching(false);
                    }
                  }}
                  disabled={isActive}
                >
                  {isActive ? t("active_label") : t("set_active")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  loading={preflighting}
                  className="flex-1 rounded-md text-xs"
                  onClick={async () => {
                    setPreflighting(true);
                    try {
                      await onPreflight(id);
                    } finally {
                      setPreflighting(false);
                    }
                  }}
                >
                  {t("check")}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="w-10 h-10 p-0 rounded-md border border-border-muted hover:bg-bg-elevated transition-all"
                  onClick={() => startEdit(activeProfileId)}
                >
                  <Edit3 size={16} />
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-text-main mb-1.5 block">
                {t("command")}
              </label>
              <Input
                value={draft.command}
                onChange={(e) =>
                  setDraft((prev) =>
                    prev ? { ...prev, command: e.target.value } : prev,
                  )
                }
                className="bg-bg-base border-border-muted rounded-md h-10 focus:ring-primary-500/20"
              />
            </div>

            <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
              <div className="space-y-1.5 flex-1">
                <label className="text-xs font-semibold text-text-main mb-1.5 block">
                  {t("active_profile")}
                </label>
                <Select
                  value={modelSelectValue}
                  options={[
                    { value: "", label: t("no_model") },
                    ...modelOptions.map((m) => ({ value: m, label: m })),
                    { value: "__custom__", label: t("custom_model") },
                  ]}
                  onChange={(val) =>
                    setDraft((prev) =>
                      prev
                        ? {
                            ...prev,
                            model:
                              val === "__custom__"
                                ? prev.model || ""
                                : val,
                          }
                        : prev,
                    )
                  }
                  className="bg-bg-base border-border-muted rounded-md h-10 focus:ring-primary-500/20"
                />
              </div>
              <Button
                size="icon"
                variant="outline"
                className="w-10 h-10 rounded-md border-border-muted hover:border-primary-500/40"
                loading={loadingModels}
                onClick={() => void onFetchModels(id, { force: true })}
              >
                <RefreshCcw
                  size={16}
                  className={cn(loadingModels && "animate-spin")}
                />
              </Button>
            </div>

            {modelSelectValue === "__custom__" && (
              <Input
                value={draft.model ?? ""}
                onChange={(e) =>
                  setDraft((prev) =>
                    prev ? { ...prev, model: e.target.value } : prev,
                  )
                }
                placeholder={t("model_custom_placeholder")}
                className="bg-bg-base border-border-muted rounded-md h-10"
              />
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-text-main mb-1.5 block">
                  {t("args")}
                </label>
                <Input
                  value={argText}
                  onChange={(e) => setArgText(e.target.value)}
                  className="bg-bg-base border-border-muted rounded-md h-10"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-text-main mb-1.5 block">
                  {t("headless_args")}
                </label>
                <Input
                  value={headlessArgText}
                  onChange={(e) => setHeadlessArgText(e.target.value)}
                  className="bg-bg-base border-border-muted rounded-md h-10"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-text-main mb-1.5 block">
                {t("execution_mode")}
              </label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={(draft.execution_mode || "cli") === "api" ? "default" : "outline"}
                  className="h-9 rounded-md text-[10px] font-semibold uppercase"
                  onClick={() =>
                    setDraft((prev) =>
                      prev
                        ? {
                            ...prev,
                            execution_mode: "api",
                            api_provider: prev.api_provider || "openai-compatible",
                            api_base_url: prev.api_base_url || "https://api.openai.com/v1",
                          }
                        : prev,
                    )
                  }
                >
                  API
                </Button>
                <Button
                  type="button"
                  variant={(draft.execution_mode || "cli") === "cli" ? "default" : "outline"}
                  className="h-9 rounded-md text-[10px] font-semibold uppercase"
                  onClick={() =>
                    setDraft((prev) =>
                      prev
                        ? {
                            ...prev,
                            execution_mode: "cli",
                          }
                        : prev,
                    )
                  }
                >
                  CLI
                </Button>
              </div>
            </div>

            {(draft.execution_mode || "cli") === "api" && (
              <div className="grid grid-cols-1 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-text-main mb-1.5 block">
                    {t("api_provider")}
                  </label>
                  <Select
                    value={draft.api_provider || "openai-compatible"}
                    options={[
                      { value: "openai-compatible", label: "OpenAI-Compatible" },
                      { value: "anthropic", label: "Anthropic" },
                    ]}
                    onChange={(val) =>
                      setDraft((prev) =>
                        prev
                          ? {
                              ...prev,
                              api_provider: val as "openai-compatible" | "anthropic",
                            }
                          : prev,
                      )
                    }
                    className="bg-bg-base border-border-muted rounded-md h-10"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-text-main mb-1.5 block">
                    {t("api_base_url")}
                  </label>
                  <Input
                    value={draft.api_base_url || ""}
                    onChange={(e) =>
                      setDraft((prev) =>
                        prev
                          ? {
                              ...prev,
                              api_base_url: e.target.value,
                            }
                          : prev,
                      )
                    }
                    placeholder="https://api.openai.com/v1"
                    className="bg-bg-base border-border-muted rounded-md h-10"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-text-main mb-1.5 block">
                    {t("api_key")}
                  </label>
                  <Input
                    type="password"
                    value={draft.api_key || ""}
                    onChange={(e) =>
                      setDraft((prev) =>
                        prev
                          ? {
                              ...prev,
                              api_key: e.target.value,
                            }
                          : prev,
                      )
                    }
                    placeholder="sk-..."
                    className="bg-bg-base border-border-muted rounded-md h-10"
                  />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-text-main mb-1.5 block">
                {t("env")}
              </label>
              <textarea
                className="w-full min-h-[100px] rounded-md border border-border-muted bg-bg-base px-4 py-3 text-xs font-mono focus:ring-2 focus:ring-primary-500/20 outline-none transition-all"
                value={envText}
                onChange={(e) => setEnvText(e.target.value)}
                placeholder="KEY=VALUE"
              />
            </div>

            <div className="flex gap-3 pt-2">
              <Button
                variant="default"
                className="flex-1 rounded-md font-bold"
                onClick={() => void commitEdit()}
                loading={saving}
              >
                <Save size={16} className="mr-2" />
                {t("save")}
              </Button>
              <Button
                variant="outline"
                className="flex-1 rounded-md font-bold"
                onClick={stopEdit}
              >
                {t("cancel")}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
