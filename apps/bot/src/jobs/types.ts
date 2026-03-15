export type RunnerTarget = "local" | "ssh";

export type JobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type Job = {
  id: string;
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
};

export type JobRecord = Job;

export type CreateJobInput = Pick<
  Job,
  | "prompt"
  | "target"
  | "status"
  | "discord_channel_id"
  | "discord_message_id"
  | "pid"
  | "log_path"
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
