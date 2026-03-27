import { useEffect } from "react";
import { useThemeState } from "./use-app-store-selectors";

export function useTheme() {
  const theme = useThemeState();

  useEffect(() => {
    const root = window.document.documentElement;
    
    if (theme === "system") {
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", theme);
    }
  }, [theme]);
}
