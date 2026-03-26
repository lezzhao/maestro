import { useMemo, useState, useEffect } from "react";
import { 
  BrainCircuit,
  ChevronRight,
  Cpu,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { useEngine } from "../../hooks/useEngine";
import { useTaskRuntimeContext } from "../../hooks/useTaskRuntimeContext";
import { useActiveTask } from "../../hooks/useActiveTask";
import { useChatStore } from "../../stores/chatStore";
import { Select } from "../ui/select";
import type { EngineModelListState } from "../../types";

export function AppHeader() {
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

  const activeTaskMessages = useChatStore((s) => s.getTaskMessages(activeTaskId));
  const totalTokens = useMemo(() => {
    return activeTaskMessages.reduce(
      (acc, msg) => {
        if (msg.role === "assistant" && msg.tokenEstimate) {
          acc.input += msg.tokenEstimate.approx_input_tokens;
          acc.output += msg.tokenEstimate.approx_output_tokens;
        }
        return acc;
      },
      { input: 0, output: 0 },
    );
  }, [activeTaskMessages]);

  return (
    <header className="h-14 flex items-center justify-between px-6 bg-bg-surface/40 backdrop-blur-2xl border-b border-border-muted/5 z-30 relative shrink-0">
      {/* Left side: Context Navigation */}
      <div className="flex items-center gap-1 h-full">
        <div className="flex items-center group px-1.5 py-1 hover:bg-bg-elevated/40 rounded-sm transition-all cursor-default border border-transparent hover:border-border-muted/20 hover:shadow-sm">
          <Select
            value={activeEngineId}
            options={engineOptions}
            onChange={(id: string) => id !== activeEngineId && switchEngine(id)}
            className="w-auto"
            buttonClassName="h-7 w-auto px-1 border-0 font-mono font-black text-[13px] text-text-main/90 hover:bg-transparent"
            icon={Cpu}
          />
        </div>

        <ChevronRight size={10} className="text-text-muted/30 mx-0" />

        <div className={cn(
          "flex items-center group px-1.5 py-1 hover:bg-bg-elevated/40 rounded-sm transition-all cursor-default border border-transparent hover:border-border-muted/20 hover:shadow-sm",
          isLoadingModels && "animate-pulse opacity-50"
        )}>
          <Select
            value={activeProfile?.model || ""}
            options={modelOptions}
            onChange={(model: string) => activeEngineId && activeProfileId && updateProfileModel(activeEngineId, activeProfileId, model)}
            className="flex-1"
            buttonClassName="h-7 w-full px-1 border-0 font-mono font-black text-[13px] text-primary transition-colors tracking-tighter hover:bg-transparent"
            icon={BrainCircuit}
            placeholder={isLoadingModels ? "..." : "Select Model"}
            isLoading={isLoadingModels}
          />
        </div>
      </div>

      {/* Right side: Task Stats Only */}
      <div className="flex items-center gap-3 h-full">
        {activeTaskId && (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 px-2 py-0.5 bg-bg-base/40 border border-border-muted/5 rounded-sm shadow-inner transition-colors group">
              <span className="text-[9px] font-mono font-black text-primary/40 uppercase tracking-tighter">IN</span>
              <span className="text-[10px] font-mono font-black text-text-main/60">{totalTokens.input.toLocaleString()}</span>
            </div>
            <div className="flex items-center gap-1.5 px-2 py-0.5 bg-bg-base/40 border border-border-muted/5 rounded-sm shadow-inner transition-colors group">
              <span className="text-[9px] font-mono font-black text-primary/40 uppercase tracking-tighter">OUT</span>
              <span className="text-[10px] font-mono font-black text-text-main/60">{totalTokens.output.toLocaleString()}</span>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
