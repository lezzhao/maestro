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
import { useTaskActions } from "../../hooks/useTaskActions";
import { useTaskAssistantTokenTotals } from "../../hooks/use-task-chat-state";
import { Select } from "../ui/select";
import { Button } from "../ui/button";
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
  const { activeTaskId, activeTask } = useActiveTask();
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

  const { handleAddTask } = useTaskActions();

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
        <div className="flex items-center gap-3 h-full pr-1">
          {/* Status Group */}
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-xl bg-secondary/20 border border-border/5">
            {activeTask && (
              <>
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-background/40 shadow-sm border border-border/5">
                  {activeTask.status === "running" ? (
                    <div className="status-dot status-dot-pulse [--status-color:theme(colors.primary)]" />
                  ) : activeTask.status === "error" ? (
                    <div className="status-dot [--status-color:theme(colors.destructive)]" />
                  ) : (
                    <div className="status-dot [--status-color:theme(colors.emerald.500)]" />
                  )}
                  <span className="text-[9px] font-black uppercase tracking-widest opacity-60">
                    {activeTask.status === "running" ? "Live" : "Ready"}
                  </span>
                </div>

                <div className="h-3 w-[1px] bg-border/20 mx-0.5" />
              </>
            )}
            
            <div className="flex items-center gap-1.5 px-1.5 text-muted-foreground/60">
              <span className="text-[9px] font-black uppercase tracking-widest">Usage</span>
              <span className="text-[11px] font-bold text-foreground/70 tabular-nums">
                {((totalTokens.input + totalTokens.output) / 1000).toFixed(1)}k
              </span>
            </div>
          </div>

          <div className="h-4 w-[1px] bg-border/40" />

          <Button
            size="sm"
            onClick={() => handleAddTask("")}
            className="h-8 rounded-lg font-semibold flex items-center gap-2 px-4 shadow-sm"
          >
            <Plus size={14} strokeWidth={2.5} />
            <span>{t("new_flow")}</span>
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              void invoke("toggle_jiavis");
              setIsJiavisActive(!isJiavisActive);
            }}
            className={cn(
              "p-2 rounded-md transition-all active:scale-90",
              isJiavisActive && "bg-primary/10 text-primary hover:bg-primary/15"
            )}
            title="Toggle Jiavis HUD (Ctrl+Shift+Space)"
          >
            <Sparkles size={18} className={cn(
              "transition-transform",
              isJiavisActive && "scale-110 rotate-[15deg]"
            )} />
            
            {isJiavisActive && (
              <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-primary rounded-full" />
            )}
          </Button>
        </div>
      }
    />
  );
}
