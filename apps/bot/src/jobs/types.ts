export type RunnerTarget = "local" | "ssh";
export type JobTool = "codex" | "autopilot";

export type JobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type JobProgress = {
  phase?: string;
  competition_slug?: string;
  run_id?: string;
  current_iter?: number;
  max_iterations?: number;
  strategy_summary?: string;
  latest_agent_message?: string;
  best_metric?: string;
  best_metric_name?: string;
  submission_status?: string;
  last_error?: string;
  updated_at?: string;
  plan?: Record<string, unknown>;
  iterations?: Array<{
    index: number;
    metric_name?: string;
    metric_value?: string;
    strategy?: string;
  }>;
};

export type Job = {
  id: string;
  tool: JobTool;
  prompt: string;
  target: RunnerTarget;
  status: JobStatus;
  created_at: string;
  updated_at: string;
  discord_channel_id: string;
  discord_message_id?: string;
  pid?: number;
  log_path?: string;
  started_at?: string;
  finished_at?: string;
  summary?: string;
  runner_id?: string;
  dashboard_url?: string;
  artifact_root?: string;
  input?: Record<string, unknown>;
  progress?: JobProgress;
};

export type JobRecord = Job;

export type CreateJobInput = Pick<
  Job,
  | "tool"
  | "prompt"
  | "target"
  | "status"
  | "discord_channel_id"
  | "discord_message_id"
  | "pid"
  | "log_path"
  | "runner_id"
  | "dashboard_url"
  | "artifact_root"
  | "input"
  | "progress"
> &
  Partial<Pick<Job, "started_at" | "finished_at" | "summary">>;

export type UpdateJobInput = Partial<
  Omit<Job, "id" | "created_at" | "updated_at">
>;

export type JobResult = {
  status: Extract<JobStatus, "succeeded" | "failed" | "cancelled">;
  summary: string;
  finished_at: string;
};
