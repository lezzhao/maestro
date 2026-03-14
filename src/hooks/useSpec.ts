import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../stores/appStore";

export function useSpec() {
  const projectPath = useAppStore((s) => s.projectPath);
  const specProvider = useAppStore((s) => s.specProvider);
  const setSpecProvider = useAppStore((s) => s.setSpecProvider);

  const applySpec = useCallback(
    async (provider: "none" | "bmad" | "custom") => {
      setSpecProvider(provider);
      if (!projectPath || provider === "none") {
        return;
      }
      await invoke("spec_inject", {
        provider,
        projectPath,
        mode: "rules_only",
        targetIde: "cursor",
      });
    },
    [projectPath, setSpecProvider],
  );

  return { specProvider, applySpec };
}
