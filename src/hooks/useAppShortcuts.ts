import { useEffect } from "react";


export function useAppShortcuts(
  commandOpen: boolean,
  setCommandOpen: (open: boolean) => void,
  showSettings: boolean,
  setShowSettings: (show: boolean) => void
) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Toggle Command Palette (Cmd/Ctrl + K)
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setCommandOpen(!commandOpen);
      }
      
      // Toggle Settings (Cmd/Ctrl + ,)
      if (e.key === "," && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setShowSettings(!showSettings);
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
