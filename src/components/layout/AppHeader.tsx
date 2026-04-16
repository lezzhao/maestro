import { useMemo, useState, useEffect } from "react";
import { 
  BrainCircuit,
  ChevronRight,
  Cpu,
  Sparkles,
  Plus,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "../../lib/utils";
import { useEngine } from "../../hooks/useEngine";
import { useTaskRuntimeContext } from "../../hooks/useTaskRuntimeContext";
import { useActiveTask } from "../../hooks/useActiveTask";
import { useTaskAssistantTokenTotals } from "../../hooks/use-task-chat-state";
import { Select } from "../ui/select";
import { PanelHeader } from "../ui/PanelHeader";
import { useTranslation } from "../../i18n";
import type { EngineModelListState } from "../../types";

export function AppHeader() {
  const { t } = useTranslation();
  const [isJiavisActive, setIsJiavisActive] = useState(false);
  const { 
    availableEngines,
    enginePreflight, 
    switchEngine, 
    listModels,
    updateProfileModel 
  } = useEngine();
  const { activeTaskId } = useActiveTask();
  const { 
    engineId: activeEngineId, 
    profileId: activeProfileId, 
    profile: activeProfile, 
  } = useTaskRuntimeContext();

  const [models, setModels] = useState<string[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);

  useEffect(() => {
    if (activeEngineId) {
      setIsLoadingModels(true);
      listModels(activeEngineId).then((res: EngineModelListState) => {
        setModels(res.models);
        setIsLoadingModels(false);
      }).catch(() => {
        setIsLoadingModels(false);
      });
    }
  }, [activeEngineId, activeProfileId, listModels]);

  const engineOptions = useMemo(
    () => availableEngines.map((e) => ({ 
      value: e.id, 
      label: e.display_name,
      status: (enginePreflight?.[e.id]?.command_exists && enginePreflight?.[e.id]?.auth_ok) ? "ready" : "warn"
    })),
    [availableEngines, enginePreflight],
  );

  const modelOptions = useMemo(
    () => models.map((m: string) => ({ value: m, label: m })),
    [models]
  );

  const totalTokens = useTaskAssistantTokenTotals(activeTaskId);

  return (
    <PanelHeader
      title={
        <div className="flex items-center gap-1.5 h-full">
          <div className="flex items-center group px-1.5 py-1 hover:bg-accent/40 rounded-lg transition-all cursor-default border border-transparent hover:border-border/10">
            <Select
              value={activeEngineId}
              options={engineOptions}
              onChange={(id: string) => id !== activeEngineId && switchEngine(id)}
              className="w-auto"
              buttonClassName="h-7 w-auto px-1 border-0 font-medium text-[13px] text-foreground/90 hover:bg-transparent tracking-tight"
              icon={Cpu}
            />
          </div>

          <ChevronRight size={12} className="text-muted-foreground/30 mx-0.5" />

          <div className={cn(
            "flex items-center group px-1.5 py-1 hover:bg-accent/40 rounded-lg transition-all cursor-default border border-transparent hover:border-border/10",
            isLoadingModels && "animate-pulse opacity-50"
          )}>
            <Select
              value={activeProfile?.model || ""}
              options={modelOptions}
              onChange={(model: string) => activeEngineId && activeProfileId && updateProfileModel(activeEngineId, activeProfileId, model)}
              className="flex-1"
              buttonClassName="h-7 w-full px-1 border-0 font-medium text-[13px] text-primary transition-colors tracking-tight hover:bg-transparent"
              icon={BrainCircuit}
              placeholder={isLoadingModels ? "..." : t("select_provider_type")} // Using a generic placeholder if needed
              isLoading={isLoadingModels}
            />
          </div>
        </div>
      }
      actions={
        <div className="flex items-center gap-3 h-full">
          {activeTaskId && (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 px-3 py-1 bg-muted/30 border border-border/10 rounded-full transition-all group hover:bg-muted/50">
                <span className="text-[9px] font-bold text-muted-foreground/50 uppercase tracking-widest">In</span>
                <span className="text-[11px] font-medium text-foreground/80 tracking-tight">{totalTokens.input.toLocaleString()}</span>
              </div>
              <div className="flex items-center gap-2 px-3 py-1 bg-muted/30 border border-border/10 rounded-full transition-all group hover:bg-muted/50">
                <span className="text-[9px] font-bold text-muted-foreground/50 uppercase tracking-widest">Out</span>
                <span className="text-[11px] font-medium text-foreground/80 tracking-tight">{totalTokens.output.toLocaleString()}</span>
              </div>
            </div>
          )}

          <div className="h-4 w-[1px] bg-border/20 mx-1" />

          <button
            onClick={() => invoke("task_create", { 
              request: { 
                title: "", 
                description: "", 
                engineId: activeEngineId, 
                workspaceBoundary: "{}" 
              } 
            })}
            className="h-8 px-4 rounded-xl bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 hover:border-primary/40 transition-all duration-300 flex items-center gap-2 group active:scale-95 shadow-lg shadow-primary/5"
            title="Create New Parallel Task"
          >
            <Plus size={14} className="group-hover:rotate-90 transition-transform duration-500" />
            <span className="text-[10px] font-black tracking-[0.2em] uppercase">{t("new_flow")}</span>
          </button>

          <div className="h-4 w-[1px] bg-border/20 mx-1" />

          <button
            onClick={() => {
              void invoke("toggle_jiavis");
              setIsJiavisActive(!isJiavisActive);
            }}
            className={cn(
              "group relative p-2 rounded-lg transition-all duration-300 border border-transparent hover:border-border/10",
              isJiavisActive && "bg-primary/10 border-primary/20 shadow-[0_0_15px_rgba(59,130,246,0.15)]"
            )}
            title="Toggle Jiavis HUD (Ctrl+Shift+Space)"
          >
            <Sparkles size={18} className={cn(
              "relative z-10 transition-all duration-500",
              isJiavisActive ? "text-primary scale-110 rotate-[15deg] drop-shadow-[0_0_8px_rgba(59,130,246,0.5)]" : "text-muted-foreground/40 group-hover:text-primary group-hover:scale-110"
            )} />
            
            {/* Subtle active dot */}
            {isJiavisActive && (
              <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-primary rounded-full animate-pulse shadow-[0_0_8px_rgba(59,130,246,0.8)]" />
            )}
            {/* Tooltip hint */}
            <div className="absolute top-full right-0 mt-2 px-2 py-1 bg-popover border border-border shadow-md opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity scale-95 group-hover:scale-100 whitespace-nowrap z-50 rounded-md">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-tight">Jiavis HUD</span>
              <span className="ml-2 text-[9px] font-mono text-primary/80 tracking-widest">⌃⇧SPACE</span>
            </div>
          </button>
        </div>
      }
    />
  );
}
