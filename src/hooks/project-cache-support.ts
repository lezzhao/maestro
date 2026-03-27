import type { FileChange } from "../types";

const PROJECT_GIT_CACHE_TTL_MS = 15_000;

type ProjectCacheMap<T> = Map<string, { value: T; ts: number }>;

interface LoadProjectGitStatusParams {
  projectPath: string;
  force?: boolean;
  cache: ProjectCacheMap<FileChange[]>;
  fetchStatus: (projectPath: string) => Promise<FileChange[]>;
}

interface LoadProjectGitDiffParams {
  projectPath: string;
  filePath?: string;
  force?: boolean;
  cache: ProjectCacheMap<string>;
  fetchDiff: (projectPath: string, filePath?: string) => Promise<string>;
}

export async function loadProjectGitStatus({
  projectPath,
  force = false,
  cache,
  fetchStatus,
}: LoadProjectGitStatusParams): Promise<FileChange[]> {
  const now = Date.now();
  const cached = cache.get(projectPath);

  if (!force && cached && now - cached.ts <= PROJECT_GIT_CACHE_TTL_MS) {
    return cached.value;
  }

  const value = await fetchStatus(projectPath);
  cache.set(projectPath, { value, ts: now });
  return value;
}

export async function loadProjectGitDiff({
  projectPath,
  filePath,
  force = false,
  cache,
  fetchDiff,
}: LoadProjectGitDiffParams): Promise<string> {
  const cacheKey = `${projectPath}::${filePath || "__all__"}`;
  const now = Date.now();
  const cached = cache.get(cacheKey);

  if (!force && cached && now - cached.ts <= PROJECT_GIT_CACHE_TTL_MS) {
    return cached.value;
  }

  const value = await fetchDiff(projectPath, filePath);
  cache.set(cacheKey, { value, ts: now });
  return value;
}
