export type PtySessionInfo = {
  session_id: string;
  os_pid?: number | null;
  task_id?: string | null;
};

export type ProcessStats = {
  session_id?: string | null;
  os_pid?: number | null;
  cpu_percent: number;
  memory_mb: number;
  running: boolean;
};

export type CliSessionListItem = {
  session_id: string;
  engine_id: string;
  task_id?: string;
  source?: string;
  status: string;
  mode: string;
  command: string;
  cwd: string;
  model: string;
  run_count: number;
  send_count: number;
  created_at: number;
  updated_at: number;
  log_size: number;
  is_last: boolean;
};

export type CliPruneResult = {
  deleted_sessions: number;
  deleted_logs: number;
};
