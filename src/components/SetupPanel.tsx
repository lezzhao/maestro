import { useMemo, useState } from "react";
import { CheckCircle2, RefreshCcw } from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";
import { useTranslation } from "../i18n";
import { GeneralSettings } from "./setup/GeneralSettings";
import { EngineCard } from "./setup/EngineCard";
import { SystemDiagnostics } from "./setup/SystemDiagnostics";
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
  onFetchModels: (
    engineId: string,
    options?: { force?: boolean },
  ) => Promise<EngineModelListState>;
  theme: "light" | "dark" | "system";
  onThemeChange: (theme: "light" | "dark" | "system") => void;
  lang: "en" | "zh";
  onLangChange: (lang: "en" | "zh") => void;
};

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
  const [preflightingAll, setPreflightingAll] = useState(false);
  const [finishedAll, setFinishedAll] = useState(false);

  return (
    <div className="space-y-10 pb-20">
      {/* 通用设置：主题 + 语言 */}
      <GeneralSettings
        theme={theme}
        onThemeChange={onThemeChange}
        lang={lang}
        onLangChange={onLangChange}
      />

      {/* 引擎列表 */}
      <section className="space-y-6">
        <div className="flex items-center justify-between px-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-semibold tracking-tight">
              {t("core_engines") || "Core Engines"}
            </h2>
            <p className="text-sm text-text-muted">
              {t("engine_desc")}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="rounded-lg h-9 px-4 border-border-muted hover:bg-bg-elevated text-text-muted hover:text-text-main transition-colors"
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
              <CheckCircle2 size={16} className="mr-1.5" />
            ) : (
              <RefreshCcw
                size={16}
                className={cn("mr-1.5", preflightingAll && "animate-spin")}
              />
            )}
            <span className="font-medium">
              {finishedAll ? t("check_done") : t("check_all")}
            </span>
          </Button>
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
      </section>

      {/* 系统诊断 */}
      <SystemDiagnostics
        activeEngineId={activeEngineId}
        engineCount={Object.keys(engines).length}
      />
    </div>
  );
}
