export type JobStatus = "queued" | "running" | "succeeded" | "failed";

export type JobRecord = {
  id: string;
  prompt: string;
  target: string;
  status: JobStatus;
  summary?: string;
  createdAt: string;
  finishedAt?: string;
};

export type CreateJobInput = Pick<JobRecord, "prompt" | "target" | "status">;

export type JobResult = {
  status: Extract<JobStatus, "succeeded" | "failed">;
  summary: string;
  finishedAt: string;
};

