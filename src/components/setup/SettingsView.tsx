import { useState } from "react";
import { 
  Settings, 
  Cpu, 
  Activity, 
  Plus
} from "lucide-react";
import { Button } from "../ui/button";
import { useTranslation } from "../../i18n";
import { EngineCard } from "./EngineCard";
import { SystemDiagnostics } from "./SystemDiagnostics";
import { ProviderCreateDialog } from "./ProviderCreateDialog";
import type {
  EngineConfig,
  EngineModelListState,
  EnginePreflightResult,
  EngineProfile,
} from "../../types";

interface SettingsViewProps {
  engines: Record<string, EngineConfig>;
  availableEngines: EngineConfig[];
  enginePreflight: Record<string, EnginePreflightResult>;
  activeEngineId: string;
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

export function SettingsView({
  engines,
  availableEngines,
  enginePreflight,
  activeEngineId,
  onSwitch,
  onPreflight,
  onPreflightAll,
  onSetActiveProfile,
  onUpsertProfile,
  onFetchModels,
  onUpsertEngine,
  theme,
  onThemeChange,
  lang,
  onLangChange,
}: SettingsViewProps) {
  const { t } = useTranslation();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showCreateProvider, setShowCreateProvider] = useState(false);

  const ControlGroup = ({ title, icon: Icon, children }: { title: string, icon: import("lucide-react").LucideIcon, children: React.ReactNode }) => (
    <div className="space-y-4">
      <div className="flex items-center gap-2 px-1">
        <Icon size={14} className="text-text-muted opacity-50" />
        <h3 className="text-[11px] font-bold uppercase tracking-[0.1em] text-text-muted">{title}</h3>
      </div>
      <div className="bg-bg-surface border border-border-muted/10 rounded-sm divide-y divide-border-muted/5">
        {children}
      </div>
    </div>
  );

  return (
    <div className="flex-1 h-full bg-bg-base overflow-y-auto custom-scrollbar p-8 md:p-12 lg:px-24">
      <div className="max-w-3xl mx-auto space-y-12">
        
        {/* Simple Header */}
        <header className="flex items-center justify-between py-6">
          <h2 className="text-xl font-bold tracking-tight text-text-main">Settings</h2>
        </header>

        <main className="space-y-10">
          
          {/* Section: Appearance & Localization */}
          <ControlGroup title="Global Preferences" icon={Settings}>
            {/* Theme Row */}
            <div className="flex items-center justify-between p-4 px-6 h-14">
              <span className="text-sm font-medium text-text-main/80">{t("theme_label") || "App Theme"}</span>
              <div className="flex gap-1 p-0.5 bg-bg-elevated/50 rounded-sm">
                {["light", "dark", "system"].map((tOpt) => (
                  <button 
                    key={tOpt}
                    onClick={() => onThemeChange(tOpt as "light" | "dark" | "system")}
                    className={`px-4 py-1 text-[10px] uppercase font-black transition-all rounded-[1px] ${
                      theme === tOpt ? "bg-bg-surface text-text-main shadow-sm" : "text-text-muted hover:text-text-main"
                    }`}
                  >
                    {tOpt}
                  </button>
                ))}
              </div>
            </div>

            {/* Language Row */}
            <div className="flex items-center justify-between p-4 px-6 h-14">
              <span className="text-sm font-medium text-text-main/80">{t("language_label") || "Language"}</span>
              <div className="flex gap-1 p-0.5 bg-bg-elevated/50 rounded-sm">
                {[
                   { id: "zh", label: "中文" },
                   { id: "en", label: "English" }
                 ].map((lOpt) => (
                   <button 
                    key={lOpt.id}
                    onClick={() => onLangChange(lOpt.id as "zh" | "en")}
                    className={`px-6 py-1 text-[10px] uppercase font-black transition-all rounded-[1px] ${
                      lang === lOpt.id ? "bg-bg-surface text-text-main shadow-sm" : "text-text-muted hover:text-text-main"
                    }`}
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
                <h3 className="text-[11px] font-bold uppercase tracking-[0.1em] text-text-muted">Language Providers</h3>
              </div>
              <div className="flex gap-2">
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="h-7 rounded-sm text-[10px] border-border-muted/20 text-text-muted hover:text-text-main hover:bg-bg-elevated font-black uppercase tracking-tight"
                  onClick={onPreflightAll}
                >
                  {t("check_all") || "Check All"}
                </Button>
                <Button 
                  size="sm" 
                  className="h-8 rounded-xl bg-primary text-white font-black text-[11px] px-6 shadow-glow hover:opacity-90 uppercase tracking-widest transition-all hover:scale-105 active:scale-95"
                  onClick={() => setShowCreateProvider(true)}
                >
                  <Plus size={14} className="mr-2" /> Add Provider
                </Button>
              </div>
            </div>

            {/* Provider List */}
            <div className="space-y-2">
               {availableEngines.map(e => (
                  <EngineCard
                    key={e.id} id={e.id} engine={e} preflight={enginePreflight[e.id]}
                    isActive={e.id === activeEngineId} activeEngineId={activeEngineId}
                    onSwitch={onSwitch} onPreflight={onPreflight}
                    onSetActiveProfile={onSetActiveProfile} onUpsertProfile={onUpsertProfile} onFetchModels={onFetchModels}
                  />
               ))}
            </div>
          </div>

          {/* New Provider Dialog Overlay */}
          {showCreateProvider && (
            <ProviderCreateDialog
              onClose={() => setShowCreateProvider(false)}
              onUpsertEngine={onUpsertEngine}
            />
          )}

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
                    <h3 className="text-[11px] font-bold uppercase tracking-[0.1em] text-text-muted">Diagnostics</h3>
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
