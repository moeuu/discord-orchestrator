import type { InteractionReplyOptions } from "discord.js";

import type { JobRecord } from "../jobs/types.js";

export function formatJobStarted(job: JobRecord): InteractionReplyOptions {
  return {
    content: `job \`${job.id}\` を登録しました。status=${job.status}`,
  };
}

export function formatJobList(jobs: JobRecord[]): InteractionReplyOptions {
  if (jobs.length === 0) {
    return { content: "ジョブはまだありません。" };
  }

  const lines = jobs.map(
    (job) => `- \`${job.id}\` ${job.status} ${job.summary ?? job.prompt}`,
  );

  return {
    content: ["直近ジョブ", ...lines].join("\n"),
  };
}

