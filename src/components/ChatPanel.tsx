import { useMemo, useState } from "react";
import { Cpu, ListTree, MessageSquare, RefreshCcw } from "lucide-react";
import { useChatStore } from "../stores/chatStore";
import { useAppStore } from "../stores/appStore";
import { useTranslation } from "../i18n";
import { cn } from "../lib/utils";
import { useChatSession } from "../hooks/useChatSession";
import { MessageList } from "./chat/MessageList";
import { ChatInput } from "./chat/ChatInput";
import type { EngineConfig } from "../types";

type ChatPanelProps = {
  projectPath: string;
  engines: Record<string, EngineConfig>;
  activeEngineId: string;
  onSetExecutionMode: (mode: "api" | "cli") => Promise<void>;
};

export function ChatPanel({
  projectPath,
  engines,
  activeEngineId,
  onSetExecutionMode,
}: ChatPanelProps) {
  const { t } = useTranslation();
  
  const activeTaskId = useAppStore((s) => s.activeTaskId);
  const enginePreflight = useAppStore((s) => s.enginePreflight);
  const setActiveEngineId = useAppStore((s) => s.setActiveEngineId);
  const setShowSettings = useAppStore((s) => s.setShowSettings);
  const isRunning = useChatStore((s) => s.getTaskRunning(activeTaskId));
  const clearMessages = useChatStore((s) => s.clearMessages);
  const clearTaskRuns = useChatStore((s) => s.clearTaskRuns);
  const [showExecutionTrace, setShowExecutionTrace] = useState(true);

  const activeEngine = engines[activeEngineId];
  const activeProfile = useMemo(() => {
    const profiles = activeEngine?.profiles || {};
    if (!profiles || Object.keys(profiles).length === 0) return undefined;
    const profileId =
      activeEngine?.active_profile_id && profiles[activeEngine.active_profile_id]
        ? activeEngine.active_profile_id
        : Object.keys(profiles)[0];
    return profileId ? profiles[profileId] : undefined;
  }, [activeEngine]);
  const executionMode = (activeProfile?.execution_mode || "cli") as "api" | "cli";

  const {
    input,
    setInput,
    executionPhase,
    handleSend,
    handleStop,
    handleRetry,
    handleCopy,
    pendingAttachments,
    removePendingAttachment,
  } = useChatSession({
    activeTaskId,
    activeEngineId,
    activeEngine,
    activeProfile,
  });

  const chatLabels = useMemo(
    () => ({
    inputPlaceholder: projectPath ? t("input_placeholder") : t("input_placeholder_no_project"),
    roleUser: t("role_user"),
    roleAssistant: t("role_assistant"),
    roleSystem: t("role_system"),
    roleAuto: t("role_auto"),
    thinking: t("thinking"),
    noOutputYet: t("no_output_yet"),
    live: t("live"),
    expandResult: t("expand_result"),
    collapseResult: t("collapse_result"),
    }),
    [projectPath, t],
  );

  const statusLabel = isRunning ? t("status_processing") : t("status_idle");
  const executionPhaseLabel =
    executionPhase === "connecting"
      ? t("stage_connecting")
      : executionPhase === "sending"
        ? t("stage_sending")
        : executionPhase === "streaming"
          ? t("stage_streaming")
          : executionPhase === "completed"
            ? t("stage_done")
            : t("stage_idle");

  const currentPreflight = enginePreflight[activeEngineId];
  const apiInvalid =
    executionMode === "api" &&
    (!activeProfile?.api_key || !activeProfile?.api_base_url || !activeProfile?.model);
  const isActiveEngineUnavailable =
    apiInvalid ||
    (executionMode !== "api" &&
      Boolean(currentPreflight && (!currentPreflight.command_exists || !currentPreflight.auth_ok)));
  const fallbackEngineId = useMemo(() => {
    if (executionMode === "api") return undefined;
    return Object.entries(enginePreflight).find(
      ([engineId, result]) =>
        engineId !== activeEngineId && result.command_exists && result.auth_ok,
    )?.[0];
  }, [activeEngineId, enginePreflight, executionMode]);
  const fallbackEngineName = fallbackEngineId ? engines[fallbackEngineId]?.display_name || fallbackEngineId : undefined;
  const sendBlockedReason = apiInvalid
    ? `${t("api_key")} / ${t("api_base_url")} / ${t("model_required")}`
    : isActiveEngineUnavailable
      ? t("event_engine_unavailable", { engine: activeEngine?.display_name || activeEngineId })
      : "";

  if (!activeTaskId) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 text-center bg-bg-base/30 backdrop-blur-sm">
        <div className="w-16 h-16 rounded-2xl bg-bg-elevated flex items-center justify-center text-text-muted/20 mb-6">
           <MessageSquare size={32} />
        </div>
        <h3 className="text-xl font-bold text-text-main mb-2">
          {t("no_active_task") || "No Active Task"}
        </h3>
        <p className="text-xs text-text-muted max-w-xs leading-relaxed font-medium opacity-60">
          {t("create_task_prompt") || "Select a task from the sidebar or create a new one to start working."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full gap-2 px-1 animate-in fade-in duration-500">
      <div className="flex items-center justify-between h-10 px-2 border-b border-border-muted/10 shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span
              className={cn(
              "w-1.5 h-1.5 rounded-full",
                isRunning ? "bg-emerald-500" : "bg-text-muted/20",
              )}
            />
            <span className="text-[10px] font-semibold text-text-muted uppercase">
              {statusLabel}
            </span>
          </div>
          
          <div className="flex items-center gap-2 text-text-muted/60">
            <Cpu size={12} />
            <span className="text-[10px] font-medium truncate max-w-[120px]">
              {activeEngine?.display_name}
              <span className="ml-1 opacity-50">{activeProfile?.model || "Auto"}</span>
            </span>
          </div>
          <div className="flex items-center gap-1 rounded-md border border-border-muted px-1 py-0.5">
            <button
              type="button"
              className={cn(
                "px-2 py-0.5 text-[10px] rounded transition-colors",
                executionMode === "api"
                  ? "bg-emerald-500/15 text-emerald-500"
                  : "text-text-muted hover:text-text-main",
              )}
              onClick={() => void onSetExecutionMode("api")}
            >
              API
            </button>
            <button
              type="button"
              className={cn(
                "px-2 py-0.5 text-[10px] rounded transition-colors",
                executionMode === "cli"
                  ? "bg-amber-500/15 text-amber-500"
                  : "text-text-muted hover:text-text-main",
              )}
              onClick={() => void onSetExecutionMode("cli")}
            >
              CLI
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowExecutionTrace((v) => !v)}
            className={cn(
              "inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-semibold border transition-colors",
              showExecutionTrace
                ? "border-primary-500/40 text-primary-500 bg-primary-500/10"
                : "border-border-muted text-text-muted hover:text-text-main",
            )}
            title={t("toggle_execution_trace")}
          >
            <ListTree size={11} />
            {showExecutionTrace ? t("execution_trace_on") : t("execution_trace_off")}
          </button>
          <button
            onClick={() => {
              if (isRunning) return;
              clearMessages(activeTaskId);
              clearTaskRuns(activeTaskId);
            }}
            disabled={isRunning}
            className="text-text-muted hover:text-rose-500 p-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title={isRunning ? "执行中不可清空，请先停止任务" : t("clear_chat")}
          >
            <RefreshCcw size={12} />
          </button>
        </div>
      </div>

      <MessageList 
        taskId={activeTaskId}
        chatLabels={chatLabels}
        handleRetry={handleRetry}
        handleCopy={handleCopy}
        t={t}
        executionPhaseLabel={executionPhaseLabel}
        showExecutionTrace={showExecutionTrace}
      />
      <div className="px-3">
        <div className="rounded-md border border-border-muted/20 bg-bg-surface/40 px-2.5 py-1.5 text-[10px] text-text-muted">
          聊天区用于追加约束、查看原始转录与人工纠偏，主审阅请在右侧进行。
        </div>
      </div>

      <ChatInput 
        input={input}
        setInput={setInput}
        isRunning={isRunning}
        pendingAttachments={pendingAttachments}
        removePendingAttachment={removePendingAttachment}
        handleSend={handleSend}
        handleStop={handleStop}
        placeholder={chatLabels.inputPlaceholder}
        sendBlocked={isActiveEngineUnavailable}
        sendBlockedReason={sendBlockedReason}
        onRecoveryAction={
          fallbackEngineId
            ? () => {
                setActiveEngineId(fallbackEngineId);
              }
            : () => setShowSettings(true)
        }
        recoveryActionLabel={
          fallbackEngineName ? t("switch_to_engine", { engine: fallbackEngineName }) : t("go_setup")
        }
      />
    </div>
  );
}
