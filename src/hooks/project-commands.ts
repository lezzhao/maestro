import { invoke } from "@tauri-apps/api/core";
import type {
  EngineRecommendation,
  FileChange,
  ProjectSetResult,
  ProjectStackResult,
} from "../types";

export function detectProjectStackCommand(projectPath: string) {
  return invoke<ProjectStackResult>("project_detect_stack", { projectPath });
}

export function setCurrentProjectCommand(projectPath: string) {
  return invoke<ProjectSetResult>("project_set_current", { projectPath });
}

export function recommendProjectEngineCommand(projectPath: string) {
  return invoke<EngineRecommendation>("project_recommend_engine", { projectPath });
}

export function getProjectGitStatusCommand(projectPath: string) {
  return invoke<FileChange[]>("project_git_status", { projectPath });
}

export function getProjectGitDiffCommand(projectPath: string, filePath?: string) {
  return invoke<string>("project_git_diff", {
    projectPath,
    filePath: filePath ?? null,
  });
}

export function readProjectFileCommand(
  projectPath: string,
  filePath: string,
  maxChars: number,
) {
  return invoke<string>("project_read_file", {
    projectPath,
    filePath,
    maxChars,
  });
}
