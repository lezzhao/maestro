import { useMemo } from "react";
import { RefreshCcw } from "lucide-react";
import { useAppUiState, useWorkspaceStoreState } from "../hooks/use-app-store-selectors";
import { useTranslation } from "../i18n";
import { cn } from "../lib/utils";
import { useChatSession } from "../hooks/useChatSession";
import { useChatPanelActions } from "../hooks/use-chat-panel-actions";
import { useTaskRunning } from "../hooks/use-task-chat-state";
import { MessageList } from "./chat/MessageList";
import { ChatInput } from "./chat/ChatInput";
import { ModeToggle } from "./ui/ModeToggle";
import { PanelHeader } from "./ui/PanelHeader";
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
  const { pinnedFiles, togglePinnedFile } = useWorkspaceStoreState();
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
    addPendingAttachments,
    isLocked,
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
  const isSendBlocked = isActiveEngineUnavailable || isLocked;
  const sendBlockedReason = isActiveEngineUnavailable
    ? t("event_engine_unavailable", { engine: activeEngine?.display_name || activeEngineId })
    : isLocked ? "连接中..." : "";

  return (
    <div className="flex flex-col h-full bg-transparent overflow-hidden animate-in fade-in duration-200">
      <PanelHeader 
        title={Boolean(activeProfile?.api_provider || activeProfile?.api_base_url) && (
          <ModeToggle 
            mode={executionMode || "cli"} 
            onChange={(m) => void onSetExecutionMode(m)} 
          />
        )}
        actions={
          <button
            onClick={() => {
              void handleClearChat();
            }}
            disabled={isRunning}
            className="text-muted-foreground/30 hover:text-rose-500 p-2 rounded-xl hover:bg-rose-500/10 transition-all disabled:opacity-20 disabled:cursor-not-allowed group active:scale-90"
            title={isRunning ? "执行中不可清空，请先停止任务" : t("clear_chat")}
          >
            <RefreshCcw size={16} className="group-hover:rotate-180 transition-transform duration-700" />
          </button>
        }
      />

      <MessageList 
        taskId={activeTaskId}
        chatLabels={chatLabels}
        handleRetry={handleRetry}
        handleCopy={handleCopy}
        handleChoiceSelect={handleChoiceSelect}
        onActionClick={(text) => {
          setInput(text);
          // Small delay to ensure state update if needed, though handleSend uses current input
          setTimeout(() => void handleSend(), 0);
        }}
        t={t}
      />

      <ChatInput 
        input={input}
        setInput={setInput}
        isRunning={isRunning}
        pendingAttachments={pendingAttachments}
        removePendingAttachment={removePendingAttachment}
        addPendingAttachments={addPendingAttachments}
        pinnedFiles={pinnedFiles}
        removePinnedFile={togglePinnedFile}
        handleSend={handleSend}
        handleStop={handleStop}
        placeholder={!isReady ? t("chat_input_placeholder_unavailable") : chatLabels.inputPlaceholder}
        sendBlocked={isSendBlocked}
        sendBlockedReason={sendBlockedReason}
        onRecoveryAction={() => setShowSettings(true)}
        recoveryActionLabel={t("go_setup")}
        taskId={activeTaskId}
      />
    </div>
  );
}
