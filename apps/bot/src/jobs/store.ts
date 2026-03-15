import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type { CreateJobInput, JobRecord } from "./types.js";

export type JobStore = {
  create(input: CreateJobInput): Promise<JobRecord>;
  update(jobId: string, patch: Partial<JobRecord>): Promise<JobRecord>;
  getByJobId(jobId: string): Promise<JobRecord | null>;
  getLatest(): Promise<JobRecord | null>;
  list(limit?: number): Promise<JobRecord[]>;
};

export function createJobStore(jobDataDir: string): JobStore {
  const jobsFile = path.join(jobDataDir, "jobs.json");

  async function ensureStore(): Promise<void> {
    await fs.mkdir(jobDataDir, { recursive: true });

    try {
      await fs.access(jobsFile);
    } catch {
      await fs.writeFile(jobsFile, "[]\n", "utf8");
    }
  }

  async function readJobs(): Promise<JobRecord[]> {
    await ensureStore();
    const raw = await fs.readFile(jobsFile, "utf8");
    return JSON.parse(raw) as JobRecord[];
  }

  async function writeJobs(jobs: JobRecord[]): Promise<void> {
    await ensureStore();
    await fs.writeFile(jobsFile, `${JSON.stringify(jobs, null, 2)}\n`, "utf8");
  }

  return {
    async create(input) {
      const jobs = await readJobs();
      const now = new Date().toISOString();
      const job: JobRecord = {
        jobId: randomUUID(),
        createdAt: now,
        updatedAt: now,
        ...input,
      };

      jobs.unshift(job);
      await writeJobs(jobs);
      return job;
    },
    async update(jobId, patch) {
      const jobs = await readJobs();
      const index = jobs.findIndex((job) => job.jobId === jobId);

      if (index === -1) {
        throw new Error(`Job not found: ${jobId}`);
      }

      jobs[index] = {
        ...jobs[index],
        ...patch,
        updatedAt: new Date().toISOString(),
      };
      await writeJobs(jobs);
      return jobs[index];
    },
    async getByJobId(jobId) {
      const jobs = await readJobs();
      return jobs.find((job) => job.jobId === jobId) ?? null;
    },
    async getLatest() {
      const jobs = await readJobs();
      return jobs[0] ?? null;
    },
    async list(limit = 10) {
      const jobs = await readJobs();
      return jobs.slice(0, limit);
    },
  };
}
