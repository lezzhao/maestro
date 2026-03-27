import { useState, useMemo } from "react";
import { 
  Settings, 
  Cpu, 
  Activity, 
  Plus
} from "lucide-react";
import { Button } from "../ui/button";
import { ChoiceDialog } from "../ui/choice-dialog";
import { useTranslation } from "../../i18n";
import { cn } from "../../lib/utils";
import { EngineCard } from "./EngineCard";
import { SystemDiagnostics } from "./SystemDiagnostics";
import { ProviderCreateDialog } from "./ProviderCreateDialog";
import type {
  EngineConfig,
  EngineModelListState,
  EnginePreflightResult,
  EngineProfile,
} from "../../types";

const SHELL_COMMANDS = ["bash", "sh", "zsh", "fish", "powershell.exe", "powershell", "pwsh", "cmd.exe", "cmd"];

interface SettingsViewProps {
  engines: Record<string, EngineConfig>;
  enginePreflight: Record<string, EnginePreflightResult>;
  activeEngineId: string;
  onDeleteEngine: (engineId: string) => Promise<void>;
  onSwitch: (engineId: string) => Promise<void>;
  onPreflight: (engineId: string) => Promise<unknown>;
  onPreflightAll: () => Promise<void>;
  onSetActiveProfile: (engineId: string, profileId: string) => Promise<void>;
  onUpsertProfile: (
    engineId: string,
    profileId: string,
    profile: EngineProfile,
  ) => Promise<void>;
  onFetchModels: (
    engineId: string,
    options?: { force?: boolean },
  ) => Promise<EngineModelListState>;
  onUpsertEngine: (id: string, engine: EngineConfig) => Promise<void>;
  theme: "light" | "dark" | "system";
  onThemeChange: (theme: "light" | "dark" | "system") => void;
  lang: "zh" | "en";
  onLangChange: (lang: "zh" | "en") => void;
}

export function SettingsView(props: SettingsViewProps) {
  const {
    engines,
    enginePreflight,
    activeEngineId,
    onSwitch,
    onPreflight,
    onPreflightAll,
    onSetActiveProfile,
    onUpsertProfile,
    onFetchModels,
    onUpsertEngine,
    onDeleteEngine,
    theme,
    onThemeChange,
    lang,
    onLangChange,
  } = props;

  const { t } = useTranslation();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showCreateProvider, setShowCreateProvider] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [cleanupCandidateIds, setCleanupCandidateIds] = useState<string[]>([]);

  const engineList = useMemo(() => {
    const list = Object.values(engines);

    return list.filter(e => {
      const activeProfile = e.profiles?.[e.active_profile_id || "default"];
      const command = activeProfile?.command?.toLowerCase() || "";
      
      // Filter out shells absolutely (exact or ends with /bash etc.)
      const isShell = SHELL_COMMANDS.some(sc => 
        command === sc || command.endsWith(`/${sc}`) || command.endsWith(`\\${sc}`)
      );
      
      // If it's a shell, hide it by default, but show it if user clicks "Show All" 
      // so they can see what's being "hidden" and delete it if they want.
      if (!showAll && isShell) {
        return false;
      }

      if (showAll) return true;

      const res = enginePreflight[e.id];
      // Valid = Preflight ran and reported both command & auth are OK
      return !res || (res.command_exists && res.auth_ok);
    });
  }, [engines, enginePreflight, showAll]);

  const hiddenCount = Object.keys(engines).length - engineList.length;

  const ControlGroup = ({ title, icon: Icon, children }: { title: string, icon: import("lucide-react").LucideIcon, children: React.ReactNode }) => (
    <div className="space-y-4">
      <div className="flex items-center gap-2 px-1">
        <Icon size={14} className="text-text-muted opacity-50" />
        <h3 className="text-[11px] font-bold uppercase tracking-widest text-text-muted">{title}</h3>
      </div>
      <div className="bg-bg-surface border border-border-muted/10 rounded-sm divide-y divide-border-muted/10">
        {children}
      </div>
    </div>
  );

  return (
    <div className="flex-1 h-full bg-bg-base overflow-y-auto custom-scrollbar p-8 md:p-12 lg:px-24">
      <div className="max-w-3xl mx-auto space-y-12">
        
        {/* Simple Header */}
        <header className="flex items-center justify-between pt-12 pb-8">
          <h2 className="text-2xl font-black tracking-tighter text-text-main uppercase">Settings</h2>
        </header>

        <main className="space-y-10">
          
          {/* Section: Appearance & Localization */}
          <ControlGroup title="Global Preferences" icon={Settings}>
            {/* Theme Row */}
            <div className="flex items-center justify-between p-4 px-6 h-14">
              <span className="text-[11px] font-bold uppercase tracking-widest text-text-main/60">{t("theme_label") || "App Theme"}</span>
              <div className="flex gap-1 p-0.5 bg-bg-elevated/50 rounded-sm">
                {["light", "dark", "system"].map((tOpt) => (
                  <button 
                    key={tOpt}
                    onClick={() => onThemeChange(tOpt as "light" | "dark" | "system")}
                    className={cn(
                      "h-7 px-5 text-[11px] uppercase font-black transition-all rounded-sm",
                      theme === tOpt 
                        ? "bg-bg-surface text-text-main shadow-sm border border-border-muted/10 cursor-default" 
                        : "text-text-muted hover:text-text-main hover:bg-bg-elevated/20"
                    )}
                  >
                    {tOpt}
                  </button>
                ))}
              </div>
            </div>

            {/* Language Row */}
            <div className="flex items-center justify-between p-4 px-6 h-14">
              <span className="text-[11px] font-bold uppercase tracking-widest text-text-main/60">{t("language_label") || "Language"}</span>
              <div className="flex gap-1 p-0.5 bg-bg-elevated/50 rounded-sm">
                {[
                   { id: "zh", label: "中文" },
                   { id: "en", label: "English" }
                 ].map((lOpt) => (
                   <button 
                    key={lOpt.id}
                    onClick={() => onLangChange(lOpt.id as "zh" | "en")}
                    className={cn(
                      "h-7 px-6 text-[11px] uppercase font-black transition-all rounded-sm",
                      lang === lOpt.id ? "bg-bg-surface text-text-main shadow-sm border border-border-muted/10" : "text-text-muted hover:text-text-main hover:bg-bg-elevated/20"
                    )}
                   >
                     {lOpt.label}
                   </button>
                 ))}
              </div>
            </div>
          </ControlGroup>

          {/* Section: Language Providers List */}
          <div className="space-y-4">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                <Cpu size={14} className="text-text-muted opacity-50" />
                <h3 className="text-[11px] font-bold uppercase tracking-widest text-text-muted">Language Providers</h3>
              </div>
              <div className="flex gap-2">
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="h-8 rounded-sm text-[11px] border-border-muted/20 text-text-muted hover:text-text-main hover:bg-bg-elevated font-black uppercase tracking-widest"
                  onClick={onPreflightAll}
                >
                  {t("check_all") || "Check All"}
                </Button>
                <Button 
                  size="sm" 
                  className="h-8 rounded-sm bg-text-main text-bg-surface font-black text-[11px] px-6 shadow-sm hover:opacity-90 uppercase tracking-widest transition-all active:scale-95"
                  onClick={() => setShowCreateProvider(true)}
                >
                  <Plus size={14} className="mr-2" /> Add Provider
                </Button>
              </div>
            </div>

            {/* Provider List */}
            <div className="space-y-2">
               {engineList.map(e => (
                  <EngineCard
                    key={e.id} id={e.id} engine={e} preflight={enginePreflight[e.id]}
                    isActive={e.id === activeEngineId} activeEngineId={activeEngineId}
                    onSwitch={onSwitch} onPreflight={onPreflight}
                    onSetActiveProfile={onSetActiveProfile} onUpsertProfile={onUpsertProfile} 
                    onFetchModels={onFetchModels} onDelete={onDeleteEngine}
                  />
               ))}
                {hiddenCount > 0 && (
                  <div className="pt-4 flex items-center justify-center gap-6 border-t border-border-muted/5">
                    <button
                      onClick={() => setShowAll(!showAll)}
                      className="text-[10px] font-bold text-text-muted/40 hover:text-text-muted/60 uppercase tracking-widest transition-colors flex items-center gap-2"
                    >
                      <span>{showAll ? "隐藏无效项 / Hide Invalid" : `+${hiddenCount} 更多无效/不完整项`}</span>
                      <div className="h-px w-4 bg-border-muted/20" />
                      {!showAll && <span>展开全部 / Show All</span>}
                    </button>

                    <button
                      onClick={async () => {
                        const toDelete = Object.values(engines).filter(e => {
                          if (e.id === activeEngineId) return false;
                          const res = enginePreflight[e.id];
                          const activeProfile = e.profiles?.[e.active_profile_id || "default"];
                          const command = activeProfile?.command?.toLowerCase() || "";
                          const isShell = SHELL_COMMANDS.some((sc: string) => 
                            command === sc || command.endsWith(`/${sc}`) || command.endsWith(`\\${sc}`)
                          );
                          
                          // Delete if: It fails preflight OR it's a blacklisted shell
                          return (res && (!res.command_exists || !res.auth_ok)) || isShell;
                        });
                        
                        if (toDelete.length === 0) return;
                        setCleanupCandidateIds(toDelete.map((engine) => engine.id));
                      }}
                      className="text-[10px] font-bold text-red-500/40 hover:text-red-500 uppercase tracking-widest transition-colors"
                    >
                      直接删除全部无效项 / Cleanup All
                    </button>
                  </div>
                )}
            </div>
          </div>

          {/* New Provider Dialog Overlay */}
          {showCreateProvider && (
            <ProviderCreateDialog
              onClose={() => setShowCreateProvider(false)}
              onUpsertEngine={onUpsertEngine}
            />
          )}

          <ChoiceDialog
            open={cleanupCandidateIds.length > 0}
            title="清理无效提供商"
            description={`将删除 ${cleanupCandidateIds.length} 个不可用或明显不是 AI 提供商的配置。此操作不可撤销。`}
            options={[
              {
                id: "cleanup-invalid-providers",
                label: "确认清理",
                description: "批量删除当前识别出的无效项，并收起完整列表。",
                variant: "destructive",
                onSelect: async () => {
                  await Promise.all(cleanupCandidateIds.map((engineId) => onDeleteEngine(engineId)));
                  setShowAll(false);
                  setCleanupCandidateIds([]);
                },
              },
            ]}
            cancelLabel="暂不清理"
            onClose={() => setCleanupCandidateIds([])}
          />

          {/* Section: System Diagnostics (Hidden by default) */}
          <div className="pt-12 border-t border-border-muted/10">
            {!showAdvanced ? (
              <div className="flex justify-center">
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="text-[10px] font-bold text-text-muted/40 hover:text-text-muted uppercase tracking-widest"
                  onClick={() => setShowAdvanced(true)}
                >
                  Show Advanced System Diagnostics
                </Button>
              </div>
            ) : (
              <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
                <div className="flex items-center justify-between px-1">
                  <div className="flex items-center gap-2">
                    <Activity size={14} className="text-text-muted opacity-50" />
                    <h3 className="text-[11px] font-bold uppercase tracking-widest text-text-muted">Diagnostics</h3>
                  </div>
                  <button 
                    onClick={() => setShowAdvanced(false)}
                    className="text-[10px] font-bold text-text-muted hover:text-text-main"
                  >
                    Hide
                  </button>
                </div>
                <div className="bg-bg-surface border border-border-muted/10 rounded-sm p-4">
                  <SystemDiagnostics
                      activeEngineId={activeEngineId}
                      engineCount={Object.keys(engines).length}
                    />
                </div>
              </div>
            )}
          </div>

        </main>
      </div>
    </div>
  );
}
