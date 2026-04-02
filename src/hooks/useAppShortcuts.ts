import { useEffect } from "react";
import { useAppStore } from "../stores/appStore";
import { useChatStore } from "../stores/chatStore";

export function useAppShortcuts(
  commandOpen: boolean,
  setCommandOpen: (open: boolean) => void,
  showSettings: boolean,
  setShowSettings: (show: boolean) => void
) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCmdOrCtrl = e.metaKey || e.ctrlKey;
      
      // Toggle Command Palette (Cmd/Ctrl + K)
      if (e.key === "k" && isCmdOrCtrl) {
        e.preventDefault();
        setCommandOpen(!commandOpen);
        return;
      }
      
      // Toggle Settings (Cmd/Ctrl + ,)
      if (e.key === "," && isCmdOrCtrl) {
        e.preventDefault();
        setShowSettings(!showSettings);
        return;
      }

      // New Conversation (Cmd/Ctrl + N)
      if (e.key === "n" && isCmdOrCtrl) {
        e.preventDefault();
        const appState = useAppStore.getState();
        const chatState = useChatStore.getState();
        
        const activeTaskId = appState.activeTaskId;
        const activeTask = appState.tasks.find(t => t.id === activeTaskId);
        
        // Find current engine/profile. Use conservative fallback if not available
        const engineId = activeTask?.resolvedRuntimeContext?.engineId || activeTask?.engineId || appState.engineConfigs?.[0]?.id || "opencode";
        const profileId = activeTask?.resolvedRuntimeContext?.profileId || activeTask?.profileId;
        
        chatState.createNewConversation(activeTaskId, engineId, profileId);
        return;
      }

      // Clear Chat (Cmd/Ctrl + L)
      if (e.key === "l" && isCmdOrCtrl) {
        e.preventDefault();
        const appState = useAppStore.getState();
        const chatState = useChatStore.getState();
        chatState.setMessages(appState.activeTaskId || "global", []);
        return;
      }
      
      // Dismiss Settings (Escape)
      if (e.key === "Escape" && showSettings) {
        setShowSettings(false);
      }
      
      // Dismiss Command Palette (Escape)
      if (e.key === "Escape" && commandOpen) {
        setCommandOpen(false);
      }
    };
    
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [commandOpen, setCommandOpen, showSettings, setShowSettings]);
}
