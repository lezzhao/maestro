import { Cpu, CheckCircle2, AlertCircle } from "lucide-react";
import type { EngineConfig, EnginePreflightResult } from "../types";
import { Button } from "./ui/button";
import { Separator } from "./ui/separator";
import { cn } from "../lib/utils";
import { useTranslation } from "../i18n";

type Props = {
  engines: Record<string, EngineConfig>;
  enginePreflight: Record<string, EnginePreflightResult>;
  activeEngineId: string;
  onSwitch: (engineId: string) => void;
};

export function Sidebar({
  engines,
  enginePreflight,
  activeEngineId,
  onSwitch,
}: Props) {
  const { t } = useTranslation();
  const ids = Object.keys(engines);
  return (
    <aside className="sidebar">
      <div className="px-2 mb-4">
        <h3 className="text-[10px] font-bold text-text-muted uppercase tracking-[0.2em] px-3 mb-2">{t("available_engines")}</h3>
        <div className="engine-list space-y-1">
          {ids.map((id) => {
            const engine = engines[id];
            const health = enginePreflight[id];
            const ok = health ? health.command_exists && health.auth_ok : true;
            const active = activeEngineId === id;
            
            return (
              <Button
                key={id}
                variant={active ? "secondary" : "ghost"}
                className={cn(
                  "w-full justify-between h-9 px-3 font-normal",
                  active && "bg-primary-500/20 text-primary-400 font-bold hover:bg-primary-500/25 border-primary-500/30 shadow-[0_0_10px_rgba(99,102,241,0.1)]"
                )}
                onClick={() => onSwitch(id)}
                title={health?.notes ?? ""}
              >
                <div className="flex items-center gap-2.5 overflow-hidden">
                  <Cpu size={14} className={cn(active ? "text-primary-400" : "text-text-muted")} />
                  <span className="truncate">{engine.display_name}</span>
                </div>
                {ok ? (
                  <CheckCircle2 size={12} className="text-emerald-500 shrink-0" />
                ) : (
                  <AlertCircle size={12} className="text-rose-500 shrink-0" />
                )}
              </Button>
            );
          })}
        </div>
      </div>
      
      <div className="mt-auto pt-4">
        <Separator className="mb-4" />
        <p className="text-[10px] text-text-muted text-center uppercase tracking-widest font-bold opacity-50">
          Omni-Agent v0.1.0
        </p>
      </div>
    </aside>
  );
}
