/** Workspace: a top-level container grouping tasks and binding a working directory. */
export type Workspace = {
  id: string;
  name: string;
  /** If empty/undefined, workspace operates in Pure Chat mode. */
  workingDirectory?: string | null;
  icon?: string | null;
  color?: string | null;
  // Workspace-level config overrides
  preferredEngineId?: string | null;
  preferredProfileId?: string | null;
  specProvider?: "none" | "maestro" | "custom" | null;
  specMode?: string | null;
  specTargetIde?: string | null;
  settings?: string | null;
  /** Unix timestamp ms */
  createdAt: number;
  /** Unix timestamp ms */
  updatedAt: number;
};

export interface ProjectStackResult {
  path: string;
  stacks: string[];
}

export interface ProjectSetResult {
  path: string;
  stacks: string[];
}
