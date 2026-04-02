import { invoke } from "@tauri-apps/api/core";

interface TaskCreateRequest {
  title: string;
  description: string;
  engineId: string;
  workspaceBoundary: string;
  profileId?: string | null;
  workspaceId?: string | null;
}

interface TaskUpdateRequest {
  id: string;
  settings?: string | null;
}

export function createTaskCommand(request: TaskCreateRequest) {
  return invoke("task_create", { request });
}

export function updateTaskCommand(request: TaskUpdateRequest) {
  return invoke("task_update", { request });
}

export function deleteTaskCommand(taskId: string) {
  return invoke("task_delete", { taskId });
}
