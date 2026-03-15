import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type { CreateJobInput, JobRecord, UpdateJobInput } from "./types.js";

export type JobStore = {
  create(input: CreateJobInput): Promise<JobRecord>;
  update(id: string, patch: UpdateJobInput): Promise<JobRecord>;
  get(id: string): Promise<JobRecord | null>;
  list(limit?: number): Promise<JobRecord[]>;
};

export function createJsonJobStore(jobDataDir: string): JobStore {
  const jobsFile = path.join(jobDataDir, "jobs.json");
  let operationChain = Promise.resolve();

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

    if (!raw.trim()) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error(`Invalid job store format: ${jobsFile}`);
    }

    return parsed as JobRecord[];
  }

  async function writeJobs(jobs: JobRecord[]): Promise<void> {
    await ensureStore();
    const nextContents = `${JSON.stringify(jobs, null, 2)}\n`;
    const tempFile = `${jobsFile}.tmp`;
    await fs.writeFile(tempFile, nextContents, "utf8");
    await fs.rename(tempFile, jobsFile);
  }

  async function runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const next = operationChain.then(operation, operation);
    operationChain = next.then(
      () => undefined,
      () => undefined,
    );
    return await next;
  }

  return {
    async create(input) {
      return await runExclusive(async () => {
        const jobs = await readJobs();
        const now = new Date().toISOString();
        const job: JobRecord = {
          id: randomUUID(),
          created_at: now,
          updated_at: now,
          ...input,
        };

        jobs.unshift(job);
        await writeJobs(jobs);
        return job;
      });
    },
    async update(id, patch) {
      return await runExclusive(async () => {
        const jobs = await readJobs();
        const index = jobs.findIndex((job) => job.id === id);

        if (index === -1) {
          throw new Error(`Job not found: ${id}`);
        }

        jobs[index] = {
          ...jobs[index],
          ...patch,
          updated_at: new Date().toISOString(),
        };
        await writeJobs(jobs);
        return jobs[index];
      });
    },
    async get(id) {
      return await runExclusive(async () => {
        const jobs = await readJobs();
        return jobs.find((job) => job.id === id) ?? null;
      });
    },
    async list(limit) {
      return await runExclusive(async () => {
        const jobs = await readJobs();
        return typeof limit === "number" ? jobs.slice(0, limit) : jobs;
      });
    },
  };
}

export const createJobStore = createJsonJobStore;
