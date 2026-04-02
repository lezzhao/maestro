import { invoke } from "@tauri-apps/api/core";
import type { Workspace } from "../../types";

interface WorkspaceCreateRequest {
  name: string;
  workingDirectory: string | null;
  icon: string | null;
  color: string | null;
  preferredEngineId: string | null;
  preferredProfileId: string | null;
  specProvider: string | null;
  specMode: string | null;
  specTargetIde: string | null;
  settings: string | null;
}

interface WorkspaceUpdateRequest {
  id: string;
  workingDirectory?: string | null;
  settings?: string | null;
}

export function createWorkspaceCommand(request: WorkspaceCreateRequest) {
  return invoke<Workspace>("workspace_create", { request });
}

export function updateWorkspaceCommand(request: WorkspaceUpdateRequest) {
  return invoke("workspace_update", { request });
}

export function deleteWorkspaceCommand(workspaceId: string) {
  return invoke("workspace_delete", { workspaceId });
}
