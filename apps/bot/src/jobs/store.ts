import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type { CreateJobInput, JobRecord } from "./types.js";

type JobStore = {
  create(input: CreateJobInput): Promise<JobRecord>;
  update(id: string, patch: Partial<JobRecord>): Promise<JobRecord>;
  list(): Promise<JobRecord[]>;
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
      const job: JobRecord = {
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        ...input,
      };

      jobs.unshift(job);
      await writeJobs(jobs);
      return job;
    },
    async update(id, patch) {
      const jobs = await readJobs();
      const index = jobs.findIndex((job) => job.id === id);

      if (index === -1) {
        throw new Error(`Job not found: ${id}`);
      }

      jobs[index] = { ...jobs[index], ...patch };
      await writeJobs(jobs);
      return jobs[index];
    },
    async list() {
      const jobs = await readJobs();
      return jobs.slice(0, 10);
    },
  };
}
