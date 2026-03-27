import { useMemo } from "react";
import { MessageSquare, RefreshCcw } from "lucide-react";
import { useAppUiState } from "../hooks/use-app-store-selectors";
import { useTranslation } from "../i18n";
import { cn } from "../lib/utils";
import { useChatSession } from "../hooks/useChatSession";
import { useChatPanelActions } from "../hooks/use-chat-panel-actions";
import { useTaskRunning } from "../hooks/use-task-chat-state";
import { MessageList } from "./chat/MessageList";
import { ChatInput } from "./chat/ChatInput";
import { useTaskRuntimeContext } from "../hooks/useTaskRuntimeContext";
import type { AppTask } from "../types";

type ChatPanelProps = {
  projectPath: string;
  activeTask: AppTask | null;
  onSetExecutionMode: (mode: "api" | "cli") => Promise<void>;
};

export function ChatPanel({
  projectPath,
  activeTask,
  onSetExecutionMode,
}: ChatPanelProps) {
  const { t } = useTranslation();
  
  const { engineId: activeEngineId, engine: activeEngine, profile: activeProfile, executionMode, isReady } = useTaskRuntimeContext();
  const activeTaskId = activeTask?.id || null;
  const { setShowSettings } = useAppUiState();
  const isRunning = useTaskRunning(activeTaskId);

  const {
    input,
    setInput,
    handleSend,
    handleStop,
    handleRetry,
    handleCopy,
    pendingAttachments,
    removePendingAttachment,
  } = useChatSession({
    activeTaskId,
    activeEngineId,
    activeProfileId: activeProfile?.id ?? null,
    activeProfile,
    executionMode,
  });
  const {
    handleChoiceSelect,
    handleClearChat,
  } = useChatPanelActions({
    activeTaskId,
    isRunning,
    setShowSettings,
    onSetExecutionMode,
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

  // Execution Phase Label is removed as the UI no longer needs it

  const isActiveEngineUnavailable = !isReady;
  const sendBlockedReason = isActiveEngineUnavailable
    ? t("event_engine_unavailable", { engine: activeEngine?.display_name || activeEngineId })
    : "";

  if (!activeTaskId) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 text-center bg-bg-surface">
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
    <div className="flex flex-col h-full bg-transparent animate-in fade-in duration-200">
      <div className="flex items-center justify-end h-[36px] px-4 border-b border-border-muted/10 shrink-0 gap-4">
        {Boolean(activeProfile?.api_provider || activeProfile?.api_base_url) && (
          <div className="flex items-center space-x-2">
            <button
              type="button"
              className={cn(
                "relative px-1.5 py-1 text-[10px] font-bold tracking-wider uppercase transition-colors shrink-0",
                executionMode === "api"
                  ? "text-emerald-500"
                  : "text-text-muted/40 hover:text-text-main",
              )}
              onClick={() => void onSetExecutionMode("api")}
            >
              API
              {executionMode === "api" && <div className="absolute -bottom-1 left-0 right-0 h-[2px] bg-emerald-500 rounded-full shadow-[0_0_6px_rgba(16,185,129,0.5)]" />}
            </button>
            <span className="text-text-muted/20 text-[10px]">|</span>
            <button
              type="button"
              className={cn(
                "relative px-1.5 py-1 text-[10px] font-bold tracking-wider uppercase transition-colors shrink-0",
                executionMode === "cli"
                  ? "text-amber-500"
                  : "text-text-muted/40 hover:text-text-main",
              )}
              onClick={() => void onSetExecutionMode("cli")}
            >
              CLI
              {executionMode === "cli" && <div className="absolute -bottom-1 left-0 right-0 h-[2px] bg-amber-500 rounded-full shadow-[0_0_6px_rgba(245,158,11,0.5)]" />}
            </button>
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              void handleClearChat();
            }}
            disabled={isRunning}
            className="text-text-muted hover:text-rose-500 p-1.5 rounded-lg hover:bg-rose-500/10 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
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
        handleChoiceSelect={handleChoiceSelect}
        t={t}
      />

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
        onRecoveryAction={() => setShowSettings(true)}
        recoveryActionLabel={t("go_setup")}
      />
    </div>
  );
}
