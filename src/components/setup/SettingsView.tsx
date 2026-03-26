import { useState, useMemo } from "react";
import { 
  Settings, 
  Cpu, 
  Activity, 
  ChevronRight,
} from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";
import { useTranslation } from "../../i18n";
import { GeneralSettings } from "./GeneralSettings";
import { EngineCard } from "./EngineCard";
import { SystemDiagnostics } from "./SystemDiagnostics";
import type {
  EngineConfig,
  EngineModelListState,
  EnginePreflightResult,
  EngineProfile,
} from "../../types";

type SettingsSection = "general" | "engines" | "diagnostics";

interface SettingsViewProps {
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
  onFetchModels: (
    engineId: string,
    options?: { force?: boolean },
  ) => Promise<EngineModelListState>;
  theme: "light" | "dark" | "system";
  onThemeChange: (theme: "light" | "dark" | "system") => void;
  lang: "en" | "zh";
  onLangChange: (lang: "en" | "zh") => void;
}

export function SettingsView({
  engines,
  enginePreflight,
  activeEngineId,
  onSwitch,
  onPreflight,
  onPreflightAll,
  onSaveEngine,
  onSetActiveProfile,
  onUpsertProfile,
  onFetchModels,
  theme,
  onThemeChange,
  lang,
  onLangChange,
}: SettingsViewProps) {
  const { t } = useTranslation();
  const [activeSection, setActiveSection] = useState<SettingsSection>("general");

  const sidebarItems = [
    { id: "general" as const, icon: Settings, label: t("general_settings") || "General" },
    { id: "engines" as const, icon: Cpu, label: t("core_engines") || "Engines" },
    { id: "diagnostics" as const, icon: Activity, label: t("system_diagnostics") || "Diagnostics" },
  ];

  const ids = useMemo(() => Object.keys(engines), [engines]);

  return (
    <div className="flex-1 h-full flex animate-in fade-in duration-300">
      {/* Settings Internal Sidebar */}
      <div className="w-64 h-full border-r border-border-muted flex flex-col bg-bg-surface/50">
        <div className="p-8 pb-4">
          <h2 className="text-xl font-bold tracking-tight text-text-main">{t("nav_setup")}</h2>
          <p className="text-xs text-text-muted mt-1 opacity-70">Configuration & Preferences</p>
        </div>

        <nav className="flex-1 px-4 space-y-1 mt-6">
          {sidebarItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveSection(item.id)}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group",
                activeSection === item.id
                  ? "bg-primary-500 text-white shadow-md shadow-primary-500/10"
                  : "text-text-muted hover:bg-bg-elevated hover:text-text-main"
              )}
            >
              <item.icon size={18} className={cn("transition-transform group-hover:scale-110", activeSection === item.id ? "text-white" : "text-text-muted")} />
              <span className="font-semibold text-sm">{item.label}</span>
              {activeSection === item.id && <ChevronRight size={14} className="ml-auto opacity-60" />}
            </button>
          ))}
        </nav>
      </div>

      {/* Main Content */}
      <div className="flex-1 h-full overflow-y-auto custom-scrollbar flex flex-col bg-bg-base/30">
        <header className="h-16 shrink-0 border-b border-border-muted flex items-center px-10 bg-bg-surface/30 sticky top-0 backdrop-blur-md z-11">
          <div className="flex items-center gap-2">
            <span className="text-text-muted/40 text-sm font-medium">Settings</span>
            <ChevronRight size={12} className="text-text-muted/20" />
            <span className="text-sm font-semibold text-text-main">
              {sidebarItems.find(i => i.id === activeSection)?.label}
            </span>
          </div>
        </header>

        <main className="flex-1 p-10 max-w-5xl">
          {activeSection === "general" && (
            <div className="animate-in slide-in-from-bottom-2 fade-in duration-300">
              <GeneralSettings
                theme={theme}
                onThemeChange={onThemeChange}
                lang={lang}
                onLangChange={onLangChange}
              />
            </div>
          )}

          {activeSection === "engines" && (
            <div className="space-y-10 animate-in slide-in-from-bottom-2 fade-in duration-300">
              <div className="flex flex-col gap-2">
                <h3 className="text-lg font-semibold">{t("core_engines")}</h3>
                <p className="text-sm text-text-muted">{t("engine_desc")}</p>
                <div className="mt-4 flex gap-3">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="rounded-lg gap-2"
                    onClick={onPreflightAll}
                  >
                    <Activity size={14} />
                    {t("check_all")}
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="rounded-lg gap-2"
                    onClick={() => {
                        const nextId = `custom-engine-${Date.now()}`;
                        void onSaveEngine(nextId, {
                          id: nextId,
                          plugin_type: "custom",
                          icon: "",
                          display_name: `Custom Engine ${ids.length + 1}`,
                          active_profile_id: "default",
                          profiles: {
                            default: {
                              id: "default",
                              display_name: "Default",
                              command: "",
                              model: "",
                              args: [],
                              env: {},
                              supports_headless: true,
                              headless_args: [],
                              ready_signal: null,
                              execution_mode: "cli",
                              api_provider: null,
                              api_base_url: null,
                              api_key: null,
                            }
                          }
                        });
                    }}
                  >
                    {t("new_profile") || "Add Custom Engine"}
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {ids.map((id) => (
                  <EngineCard
                    key={id}
                    id={id}
                    engine={engines[id]}
                    preflight={enginePreflight[id]}
                    isActive={id === activeEngineId}
                    activeEngineId={activeEngineId}
                    onSwitch={onSwitch}
                    onPreflight={onPreflight}
                    onSetActiveProfile={onSetActiveProfile}
                    onUpsertProfile={onUpsertProfile}
                    onFetchModels={onFetchModels}
                  />
                ))}
              </div>
            </div>
          )}

          {activeSection === "diagnostics" && (
            <div className="animate-in slide-in-from-bottom-2 fade-in duration-300">
              <SystemDiagnostics
                activeEngineId={activeEngineId}
                engineCount={Object.keys(engines).length}
              />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
