import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildAutopilotArgs,
  readAutopilotProgress,
  resolveArtifactRoot,
} from "./autopilot.js";

describe("autopilot", () => {
  it("builds autopilot args from natural-language job input", () => {
    expect(
      buildAutopilotArgs({
        competition: "house-prices",
        instruction: "Try strong tree baselines first",
        compute: "local_gpu",
        maxIterations: 4,
        dryRun: true,
      }),
    ).toEqual([
      "run",
      "kagglebot",
      "autopilot",
      "house-prices",
      "--compute",
      "local_gpu",
      "--max-iterations",
      "4",
      "--dry-run",
      "--goal",
      "Try strong tree baselines first",
    ]);
  });

  it("reads strategy and iteration progress from artifacts", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "autopilot-artifacts-"));
    const artifactRoot = resolveArtifactRoot(tempRoot, "house-prices");
    const runDir = path.join(artifactRoot, "runs", "run-001");

    await fs.mkdir(path.join(runDir, "iter-1"), { recursive: true });
    await fs.mkdir(path.join(runDir, "iter-2"), { recursive: true });
    await fs.mkdir(path.join(runDir, "agent"), { recursive: true });
    await fs.writeFile(
      path.join(artifactRoot, "plan.json"),
      JSON.stringify({
        target_metric: "rmse",
        cv_folds: 5,
        internet: "off",
        max_iterations: 4,
      }),
      "utf8",
    );
    await fs.writeFile(
      path.join(runDir, "run.json"),
      JSON.stringify({ run_id: "run-001", status: "running" }),
      "utf8",
    );
    await fs.writeFile(
      path.join(runDir, "run_state.json"),
      JSON.stringify({
        submit_attempted: true,
        last_action: "submit_waiting",
      }),
      "utf8",
    );
    await fs.writeFile(
      path.join(runDir, "iter-1", "metrics.json"),
      JSON.stringify({ rmse: 0.141 }),
      "utf8",
    );
    await fs.writeFile(
      path.join(runDir, "iter-1", "diagnostics.md"),
      "# Diagnostics\nTried LightGBM baseline with basic feature cleaning.",
      "utf8",
    );
    await fs.writeFile(
      path.join(runDir, "iter-2", "metrics.json"),
      JSON.stringify({ rmse: 0.128 }),
      "utf8",
    );
    await fs.writeFile(
      path.join(runDir, "iter-2", "diagnostics.md"),
      "# Diagnostics\nSwitched to CatBoost with target encoding for categoricals.",
      "utf8",
    );
    await fs.writeFile(
      path.join(runDir, "agent", "codex_last_message.txt"),
      "Refining feature interactions before the next submit.",
      "utf8",
    );

    const progress = await readAutopilotProgress(artifactRoot);

    expect(progress?.competition_slug).toBe("house-prices");
    expect(progress?.run_id).toBe("run-001");
    expect(progress?.phase).toBe("submitting");
    expect(progress?.current_iter).toBe(2);
    expect(progress?.max_iterations).toBe(4);
    expect(progress?.best_metric_name).toBe("rmse");
    expect(progress?.best_metric).toBe("0.128");
    expect(progress?.submission_status).toBe("submit_waiting");
    expect(progress?.strategy_summary).toContain("CatBoost");
    expect(progress?.iterations).toHaveLength(2);
  });
});
