import { ReactNode } from "react";
import { usePerformance } from "../../hooks/usePerformance";
import { useTheme } from "../../hooks/useTheme";

export function AppProviders({ children }: { children: ReactNode }) {
  useTheme();
  usePerformance();
  
  return <>{children}</>;
}
