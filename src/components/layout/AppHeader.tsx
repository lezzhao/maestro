import { useMemo, useState, useEffect } from "react";
import { 
  Settings, 
  Cpu, 
  BrainCircuit,
  Settings2,
  ChevronRight,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { useEngine } from "../../hooks/useEngine";
import { useTaskRuntimeContext } from "../../hooks/useTaskRuntimeContext";
import { useActiveTask } from "../../hooks/useActiveTask";
import { useChatStore } from "../../stores/chatStore";
import { Select } from "../ui/select";
import type { EngineModelListState } from "../../types";

interface AppHeaderProps {
  showSettings: boolean;
  onToggleSettings: () => void;
}

export function AppHeader({ showSettings, onToggleSettings }: AppHeaderProps) {
  const { 
    engines, 
    enginePreflight, 
    switchEngine, 
    setActiveProfile, 
    updateTaskProfile,
    listModels,
    updateProfileModel 
  } = useEngine();
  const { activeTaskId } = useActiveTask();
  const { 
    engineId: activeEngineId, 
    profileId: activeProfileId, 
    profile: activeProfile, 
    isReady: isEngineReady 
  } = useTaskRuntimeContext();

  const [models, setModels] = useState<string[]>([]);

  useEffect(() => {
    if (activeEngineId) {
      listModels(activeEngineId).then((res: EngineModelListState) => {
        setModels(res.models);
      });
    }
  }, [activeEngineId, activeProfileId, listModels]);

  const activeTaskMessages = useChatStore((s) => s.getTaskMessages(activeTaskId));
  const totalTokens = useMemo(() => {
    let input = 0;
    let output = 0;
    activeTaskMessages.forEach((m) => {
      if (m.tokenEstimate) {
        input += m.tokenEstimate.approx_input_tokens || 0;
        output += m.tokenEstimate.approx_output_tokens || 0;
      }
    });
    return { input, output };
  }, [activeTaskMessages]);

  const engineOptions = useMemo(
    () =>
      Object.entries(engines)
        .filter(([id]) => enginePreflight[id]?.command_exists !== false)
        .map(([id, engine]) => ({
          value: id,
          label: engine.display_name || id,
        })),
    [enginePreflight, engines],
  );

  const profileOptions = useMemo(
    () =>
      Object.values(engines[activeEngineId]?.profiles || {}).map((p) => ({
        value: p.id,
        label: p.display_name || p.id,
      })),
    [engines, activeEngineId],
  );

  const modelOptions = useMemo(
    () => models.map(m => ({ value: m, label: m })),
    [models]
  );
  return (
    <header className="h-[48px] border-b border-border-muted/20 bg-bg-surface/95 backdrop-blur-md flex items-center justify-between px-4 z-50 shrink-0 select-none">
      {/* breadcrumb core */}
      <div className="flex items-center gap-1">
        <div className="flex items-center group px-2 py-1.5 hover:bg-bg-elevated/40 rounded-lg transition-all cursor-default border border-transparent hover:border-border-muted/10">
          <div className={cn(
            "h-1.5 w-1.5 rounded-full mr-2 transition-all duration-500", 
            isEngineReady 
              ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.3)]" 
              : "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.3)] animate-pulse"
          )} />
          <Select
            value={activeEngineId}
            options={engineOptions}
            onChange={(id: string) => id !== activeEngineId && switchEngine(id)}
            className="w-auto"
            buttonClassName="h-7 w-auto px-1 border-0 font-bold text-text-main/70 hover:bg-transparent"
            icon={Cpu}
          />
        </div>

        <ChevronRight size={12} className="text-text-muted/20 mx-0.5" />

        <div className="flex items-center group px-2 py-1.5 hover:bg-bg-elevated/40 rounded-lg transition-all cursor-default border border-transparent hover:border-border-muted/10">
          <Select
            value={activeProfileId || ""}
            options={profileOptions}
            onChange={async (id: string) => {
              if (activeTaskId && activeEngineId) {
                await updateTaskProfile(activeTaskId, activeEngineId, id);
              } else {
                await setActiveProfile(activeEngineId, id);
              }
            }}
            className="w-auto"
            buttonClassName="h-7 w-auto px-1 border-0 font-medium text-text-muted/50 hover:bg-transparent"
            icon={Settings2}
            placeholder="Cfg"
          />
        </div>

        <ChevronRight size={12} className="text-text-muted/20 mx-0.5" />

        <div className="flex items-center group px-2 py-1.5 bg-primary-500/5 hover:bg-primary-500/10 rounded-lg border border-primary-500/10 transition-all cursor-default">
          <Select
            value={activeProfile?.model || ""}
            options={modelOptions}
            onChange={(model: string) => activeEngineId && activeProfileId && updateProfileModel(activeEngineId, activeProfileId, model)}
            className="w-auto"
            buttonClassName="h-7 w-auto px-1 border-0 font-black text-primary-500 transition-colors uppercase tracking-tight hover:bg-transparent"
            icon={BrainCircuit}
            placeholder="Model"
          />
        </div>
      </div>

      {/* Right side: Stats & Action */}
      <div className="flex items-center gap-6">
        {activeTaskId && (
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-2.5 py-1 bg-emerald-500/5 rounded-md border border-emerald-500/10 opacity-70 hover:opacity-100 transition-opacity group">
              <span className="text-[9px] font-black text-emerald-500/30 uppercase tracking-widest group-hover:text-emerald-500/50">In</span>
              <span className="text-[11px] font-mono font-bold text-emerald-600/80">{totalTokens.input.toLocaleString()}</span>
            </div>
            <div className="flex items-center gap-2 px-2.5 py-1 bg-blue-500/5 rounded-md border border-blue-500/10 opacity-70 hover:opacity-100 transition-opacity group">
              <span className="text-[9px] font-black text-blue-500/30 uppercase tracking-widest group-hover:text-blue-500/50">Out</span>
              <span className="text-[11px] font-mono font-bold text-blue-600/80">{totalTokens.output.toLocaleString()}</span>
            </div>
          </div>
        )}

        <div className="flex items-center pl-4 border-l border-border-muted/10">
          <button
            onClick={onToggleSettings}
            className={cn(
              "p-2 rounded-lg transition-all duration-300",
              showSettings 
                ? "bg-primary-500 text-white shadow-lg shadow-primary-500/20" 
                : "text-text-muted/40 hover:bg-bg-elevated hover:text-text-main"
            )}
            title="Settings"
          >
            <Settings size={16} className={cn("transition-transform duration-700", showSettings && "rotate-180")} />
          </button>
        </div>
      </div>
    </header>
  );
}
