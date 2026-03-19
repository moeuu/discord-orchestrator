import { afterEach, describe, expect, it } from "vitest";

import { startDashboardServer } from "./dashboard.js";
import type { JobRecord } from "./jobs/types.js";

const noopLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

describe("dashboard", () => {
  const servers: Array<{ close: () => void }> = [];

  afterEach(() => {
    for (const server of servers) {
      server.close();
    }
    servers.length = 0;
  });

  it("serves job list and detail json", async () => {
    const job: JobRecord = {
      id: "job-1",
      tool: "autopilot",
      prompt: "Optimize house prices",
      target: "local",
      status: "running",
      created_at: "2026-03-15T00:00:00.000Z",
      updated_at: "2026-03-15T00:00:00.000Z",
      discord_channel_id: "channel-1",
      summary: "phase=iterating | iter=2",
      runner_id: "lab_rdp",
      progress: {
        phase: "iterating",
        current_iter: 2,
        strategy_summary: "Trying CatBoost and feature interactions.",
      },
    };
    const service = {
      async listJobs() {
        return [job];
      },
      async getJob(jobId: string) {
        return jobId === job.id ? job : null;
      },
      async getLogInfo() {
        return { preview: "latest log lines" };
      },
      async claimNextRunnerJob() {
        return null;
      },
      async markRunnerJobStarted() {
        return null;
      },
      async appendRunnerCodexEvent() {
        return { job: null, cancelRequested: false };
      },
      async heartbeatRunnerJob() {
        return { job: null, cancelRequested: false };
      },
      async finishRunnerJob() {
        return null;
      },
    };

    const server = startDashboardServer(0, "127.0.0.1", service, noopLogger);
    servers.push(server);
    await new Promise<void>((resolve) => server.on("listening", () => resolve()));

    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const jobsResponse = await fetch(`http://127.0.0.1:${port}/api/jobs`);
    const jobsPayload = await jobsResponse.json();
    const detailResponse = await fetch(`http://127.0.0.1:${port}/api/jobs/${job.id}`);
    const detailPayload = await detailResponse.json();

    expect(jobsPayload.jobs).toHaveLength(1);
    expect(jobsPayload.jobs[0].tool).toBe("autopilot");
    expect(detailPayload.job.id).toBe(job.id);
    expect(detailPayload.log).toContain("latest log lines");
  });

  it("authorizes and returns claimed jobs for runner polling", async () => {
    const job: JobRecord = {
      id: "job-2",
      tool: "codex",
      prompt: "fix tests",
      target: "runner",
      runner_id: "macbook",
      status: "running",
      created_at: "2026-03-15T00:00:00.000Z",
      updated_at: "2026-03-15T00:00:00.000Z",
      discord_channel_id: "channel-1",
      summary: "Preparing workspace clone",
    };
    const service = {
      async listJobs() {
        return [job];
      },
      async getJob(jobId: string) {
        return jobId === job.id ? job : null;
      },
      async getLogInfo() {
        return { preview: null };
      },
      async claimNextRunnerJob(runnerId: string) {
        return runnerId === "macbook" ? job : null;
      },
      async markRunnerJobStarted() {
        return job;
      },
      async appendRunnerCodexEvent() {
        return { job, cancelRequested: false };
      },
      async heartbeatRunnerJob() {
        return { job, cancelRequested: false };
      },
      async finishRunnerJob() {
        return job;
      },
    };

    const server = startDashboardServer(0, "127.0.0.1", service, noopLogger, {
      runnerApiToken: "secret",
      runnerLongPollTimeoutMs: 10,
      runnerPollIntervalMs: 1,
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.on("listening", () => resolve()));

    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const unauthorized = await fetch(`http://127.0.0.1:${port}/api/runner/poll`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runnerId: "macbook" }),
    });
    expect(unauthorized.status).toBe(401);

    const response = await fetch(`http://127.0.0.1:${port}/api/runner/poll`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer secret",
      },
      body: JSON.stringify({ runnerId: "macbook" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.job.id).toBe("job-2");
  });
});
