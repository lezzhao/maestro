import { useState, useMemo } from "react";
import { 
  Settings, 
  Activity, 
  LayoutGrid,
  ShieldCheck,
  Globe
} from "lucide-react";
import { Button } from "../ui/button";
import { ChoiceDialog } from "../ui/choice-dialog";
import { useTranslation } from "../../i18n";
import { cn } from "../../lib/utils";
import { EngineCard } from "./EngineCard";
import { SystemDiagnostics } from "./SystemDiagnostics";
import { ProviderMarketplace, type ProviderMarketItem } from "./ProviderMarketplace";
import { ProviderConfigDrawer } from "./ProviderConfigDrawer";
import type {
  EngineConfig,
  EngineModelListState,
  EnginePreflightResult,
  EngineProfile,
  AuthScheme,
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
  onVerifyConnection: (providerId: string, auth: AuthScheme, baseUrl?: string) => Promise<{ success: boolean; message: string; available_models: string[] }>;
  theme: "light" | "dark" | "system";
  onThemeChange: (theme: "light" | "dark" | "system") => void;
  lang: "zh" | "en";
  onLangChange: (lang: "zh" | "en") => void;
}

type TabType = "marketplace" | "connected" | "general";

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
    onVerifyConnection,
    theme,
    onThemeChange,
    lang,
    onLangChange,
  } = props;

  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabType>("marketplace");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selectedMarketProvider, setSelectedMarketProvider] = useState<ProviderMarketItem | null>(null);
  const [showAll] = useState(false);
  const [cleanupCandidateIds, setCleanupCandidateIds] = useState<string[]>([]);

  const connectedList = useMemo(() => {
    return Object.values(engines).filter(e => {
        const activeProfile = e.profiles?.[e.active_profile_id || "default"];
        const command = activeProfile?.command?.toLowerCase() || "";
        const isShell = SHELL_COMMANDS.some(sc => command === sc || command.endsWith(`/${sc}`));
        if (!showAll && isShell) return false;
        return true;
    });
  }, [engines, showAll]);

  const ControlGroup = ({ title, icon: Icon, children }: { title: string, icon: import("lucide-react").LucideIcon, children: React.ReactNode }) => (
    <div className="space-y-4">
      <div className="flex items-center gap-2 px-1">
        <Icon size={14} className="text-text-muted opacity-50" />
        <h3 className="text-[11px] font-bold uppercase tracking-widest text-text-muted">{title}</h3>
      </div>
      <div className="bg-bg-surface border border-border-muted/10 rounded-2xl divide-y divide-border-muted/10 overflow-hidden">
        {children}
      </div>
    </div>
  );

  return (
    <div className="flex-1 h-full bg-bg-base overflow-y-auto custom-scrollbar p-8 md:p-12 lg:px-24">
      <div className="max-w-4xl mx-auto space-y-12">
        
        {/* Modern Tabbed Header */}
        <header className="flex flex-col gap-8 pt-12">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-black tracking-tighter text-text-main uppercase">Engine Center</h2>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 animate-pulse">
                <ShieldCheck size={14} />
                <span className="text-[10px] font-black uppercase tracking-wider">Local & Secure</span>
            </div>
          </div>

          <div className="flex gap-1 p-1 bg-bg-surface border border-border-muted/10 rounded-2xl w-fit">
               {[
                  { id: "marketplace", label: "Marketplace", icon: LayoutGrid },
                  { id: "connected", label: "Connected", icon: Globe },
                  { id: "general", label: "General", icon: Settings }
               ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as TabType)}
                    className={cn(
                        "flex items-center gap-2 px-6 h-10 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all",
                        activeTab === tab.id 
                            ? "bg-primary text-white shadow-lg shadow-primary/20" 
                            : "text-text-muted hover:text-text-main hover:bg-bg-elevated/50"
                    )}
                  >
                    <tab.icon size={14} />
                    {tab.label}
                  </button>
               ))}
          </div>
        </header>

        <main className="min-h-[500px]">
          {activeTab === "marketplace" && (
            <div className="space-y-6">
                <div className="flex items-center gap-3 text-text-muted/60 mb-2">
                    <LayoutGrid size={16} />
                    <span className="text-sm font-medium italic">Discover and connect to elite AI providers...</span>
                </div>
                <ProviderMarketplace onSelectProvider={setSelectedMarketProvider} />
            </div>
          )}

          {activeTab === "connected" && (
            <div className="space-y-8 animate-in fade-in duration-500">
               <div className="flex items-center justify-between px-1">
                   <div className="flex items-center gap-2 text-text-muted/60">
                       <Globe size={16} />
                       <span className="text-sm font-medium italic">Managing {connectedList.length} active connections</span>
                   </div>
                   <Button 
                      variant="outline" 
                      size="sm" 
                      className="h-8 rounded-xl text-[10px] border-border-muted/20 text-text-muted font-black uppercase tracking-widest"
                      onClick={onPreflightAll}
                   >
                       Refresh All Status
                   </Button>
               </div>

               <div className="space-y-3">
                  {connectedList.map(e => (
                      <EngineCard
                        key={e.id} id={e.id} engine={e} preflight={enginePreflight[e.id]}
                        isActive={e.id === activeEngineId} activeEngineId={activeEngineId}
                        onSwitch={onSwitch} onPreflight={onPreflight}
                        onSetActiveProfile={onSetActiveProfile} onUpsertProfile={onUpsertProfile} 
                        onFetchModels={onFetchModels} onDelete={onDeleteEngine}
                      />
                  ))}
               </div>
            </div>
          )}

          {activeTab === "general" && (
            <div className="space-y-10 animate-in fade-in duration-500">
                <ControlGroup title="Global Preferences" icon={Settings}>
                    <div className="flex items-center justify-between p-4 px-6 h-16">
                    <span className="text-[11px] font-bold uppercase tracking-widest text-text-main/60">{t("theme_label") || "App Theme"}</span>
                    <div className="flex gap-1 p-0.5 bg-bg-elevated/50 rounded-xl">
                        {["light", "dark", "system"].map((tOpt) => (
                        <button 
                            key={tOpt}
                            onClick={() => onThemeChange(tOpt as "light" | "dark" | "system")}
                            className={cn(
                            "h-8 px-6 text-[10px] uppercase font-black transition-all rounded-lg",
                            theme === tOpt 
                                ? "bg-bg-surface text-text-main shadow-sm border border-border-muted/10" 
                                : "text-text-muted hover:text-text-main hover:bg-bg-elevated/20"
                            )}
                        >
                            {tOpt}
                        </button>
                        ))}
                    </div>
                    </div>

                    <div className="flex items-center justify-between p-4 px-6 h-16">
                    <span className="text-[11px] font-bold uppercase tracking-widest text-text-main/60">{t("language_label") || "Language"}</span>
                    <div className="flex gap-1 p-0.5 bg-bg-elevated/50 rounded-xl">
                        {[
                        { id: "zh", label: "中文" },
                        { id: "en", label: "English" }
                        ].map((lOpt) => (
                        <button 
                            key={lOpt.id}
                            onClick={() => onLangChange(lOpt.id as "zh" | "en")}
                            className={cn(
                            "h-8 px-8 text-[10px] uppercase font-black transition-all rounded-lg",
                            lang === lOpt.id ? "bg-bg-surface text-text-main shadow-sm border border-border-muted/10" : "text-text-muted hover:text-text-main hover:bg-bg-elevated/20"
                            )}
                        >
                            {lOpt.label}
                        </button>
                        ))}
                    </div>
                    </div>
                </ControlGroup>

                {/* Diagnostics */}
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
                    <div className="space-y-4 pt-12 border-t border-border-muted/10">
                        <div className="flex items-center justify-between px-1">
                            <div className="flex items-center gap-2">
                                <Activity size={14} className="text-text-muted opacity-50" />
                                <h3 className="text-[11px] font-bold uppercase tracking-widest text-text-muted">Diagnostics</h3>
                            </div>
                            <button onClick={() => setShowAdvanced(false)} className="text-[10px] font-bold text-text-muted hover:text-text-main uppercase tracking-widest">Hide</button>
                        </div>
                        <div className="bg-bg-surface border border-border-muted/10 rounded-2xl p-6">
                            <SystemDiagnostics activeEngineId={activeEngineId} engineCount={Object.keys(engines).length} />
                        </div>
                    </div>
                )}
            </div>
          )}
        </main>

        <ProviderConfigDrawer 
            provider={selectedMarketProvider}
            onClose={() => setSelectedMarketProvider(null)}
            onVerify={onVerifyConnection}
            onSave={(config) => onUpsertEngine(config.id, config)}
        />

        <ChoiceDialog
            open={cleanupCandidateIds.length > 0}
            title="清理无效提供商"
            description={`将删除 ${cleanupCandidateIds.length} 个不完整的配置。此操作不可撤销。`}
            options={[{
                id: "cleanup-invalid-providers",
                label: "确认清理",
                variant: "destructive",
                onSelect: async () => {
                    await Promise.all(cleanupCandidateIds.map(onDeleteEngine));
                    setCleanupCandidateIds([]);
                },
            }]}
            cancelLabel="暂不清理"
            onClose={() => setCleanupCandidateIds([])}
        />
      </div>
    </div>
  );
}
