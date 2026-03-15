export type RunnerTarget = "local" | "ssh";

export type JobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type JobRecord = {
  jobId: string;
  prompt: string;
  target: RunnerTarget;
  status: JobStatus;
  discordMessageId?: string;
  logPath?: string;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
  updatedAt: string;
  summary?: string;
};

export type CreateJobInput = Pick<
  JobRecord,
  "prompt" | "target" | "status" | "discordMessageId" | "logPath"
> &
  Partial<Pick<JobRecord, "startedAt" | "finishedAt" | "summary">>;

export type JobResult = {
  status: Extract<JobStatus, "succeeded" | "failed" | "cancelled">;
  summary: string;
  finishedAt: string;
};
