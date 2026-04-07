export type WorkflowStep = {
  engine: string;
  profile_id?: string;
  prompt: string;
  completion_signal?: string;
  timeout_ms?: number;
};

export type WorkflowRunRequest = {
  name: string;
  steps: WorkflowStep[];
  task_id?: string | null;
};

export type TokenEstimate = {
  input_chars: number;
  output_chars: number;
  approx_input_tokens: number;
  approx_output_tokens: number;
};

export type WorkflowProgressEvent = {
  workflow_name: string;
  step_index: number;
  total_steps: number;
  engine: string;
  status: string;
  message: string;
  token_estimate?: TokenEstimate | null;
};

export type TestCaseResult = {
  name: string;
  status: "passed" | "failed" | "skipped";
  duration_ms?: number | null;
  error?: string | null;
};

export type TestSuiteResult = {
  name: string;
  total_cases: number;
  passed_cases: number;
  failed_cases: number;
  skipped_cases: number;
  duration_ms?: number | null;
  cases: TestCaseResult[];
};

export type TestRunSummary = {
  framework: "vitest" | "jest" | "playwright" | "cypress" | "unknown";
  success: boolean;
  total_suites: number;
  passed_suites: number;
  failed_suites: number;
  total_cases: number;
  passed_cases: number;
  failed_cases: number;
  skipped_cases: number;
  duration_ms?: number | null;
  suites: TestSuiteResult[];
  raw_summary?: string | null;
};

export type VerificationSummary = {
  has_verification: boolean;
  test_run?: TestRunSummary | null;
  source?: string | null;
  notes?: string | null;
};

export type WorkflowStepResult = {
  engine: string;
  mode: string;
  fallback: boolean;
  success: boolean;
  completion_matched: boolean;
  failure_reason?: string | null;
  duration_ms: number;
  output: string;
  verification?: VerificationSummary | null;
};

export type WorkflowRunResult = {
  workflow_name: string;
  used_fallback: boolean;
  completed: boolean;
  archive_path: string;
  step_results: WorkflowStepResult[];
  verification?: VerificationSummary | null;
};

export type StepRunRequest = {
  workflow_name: string;
  step: WorkflowStep;
  step_index: number;
  total_steps: number;
};

export type StepRunResult = WorkflowStepResult & {
  token_estimate: TokenEstimate;
};

export type WorkflowArchiveEntry = {
  name: string;
  path: string;
  modified_ts: number;
  completed: boolean;
  workflow_name: string;
  failed_count: number;
};

export type WorkflowArchiveFailedStep = {
  index: number;
  engine: string;
  mode: string;
  status: "failed" | "not-matched";
  reason: string;
};

export type WorkflowArchiveDetail = {
  name: string;
  path: string;
  modified_ts: number;
  workflow_name: string;
  completed: boolean;
  used_fallback: boolean;
  step_count: number;
  failed_count: number;
  failed_steps: WorkflowArchiveFailedStep[];
  verification?: VerificationSummary | null;
};

export type WorkflowArchiveExportResult = {
  path: string;
  count: number;
};

export type WorkflowFullArchive = {
  request?: {
    name?: string;
    steps?: Array<{
      engine?: string;
      profile_id?: string;
      prompt?: string;
      completion_signal?: string;
      timeout_ms?: number;
    }>;
  };
  result?: {
    workflow_name?: string;
    completed?: boolean;
    archive_path?: string;
    step_results?: Array<{
      engine?: string;
      mode?: string;
      output?: string;
      success?: boolean;
      completion_matched?: boolean;
      failure_reason?: string | null;
      verification?: VerificationSummary | null;
    }>;
    verification?: VerificationSummary | null;
  };
};

export type EngineHistoryEntry = {
  id: string;
  engine_id: string;
  profile_id: string;
  workflow_name: string;
  step_index: number;
  mode: string;
  success: boolean;
  completion_matched: boolean;
  failure_reason?: string | null;
  duration_ms: number;
  summary: string;
  created_ts: number;
  detail_path: string;
};

export type EngineHistoryDetail = {
  id: string;
  engine_id: string;
  profile_id: string;
  workflow_name: string;
  step_index: number;
  mode: string;
  created_ts: number;
  prompt: string;
  output: string;
};

export type EngineHistoryPage = {
  entries: EngineHistoryEntry[];
  total: number;
  page: number;
  page_size: number;
};
