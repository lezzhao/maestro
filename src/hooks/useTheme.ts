import { useEffect } from "react";
import { useAppStore } from "../stores/appStore";

export function useTheme() {
  const { theme } = useAppStore();

  useEffect(() => {
    const root = window.document.documentElement;
    
    if (theme === "system") {
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", theme);
    }
  }, [theme]);
}
