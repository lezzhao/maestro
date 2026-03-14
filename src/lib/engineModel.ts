function hasModelFlag(args: string[]): boolean {
  return args.some((arg) => {
    const v = arg.trim();
    return v === "--model" || v === "-m" || v.startsWith("--model=") || v.startsWith("-m=");
  });
}

function modelFlagForEngine(engineId: string): string {
  switch (engineId) {
    case "cursor":
    case "claude":
    case "gemini":
    case "codex":
    case "opencode":
    default:
      return "--model";
  }
}

export function withModelArgs(args: string[], engineId: string, model?: string): string[] {
  const normalized = (model || "").trim();
  if (!normalized || hasModelFlag(args)) {
    return args;
  }
  return [...args, modelFlagForEngine(engineId), normalized];
}
