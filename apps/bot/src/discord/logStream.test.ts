import { describe, expect, it } from "vitest";

import { chunkForDiscord } from "./logStream.js";

describe("chunkForDiscord", () => {
  it("splits long log output into Discord-sized chunks", () => {
    const longLine = "x".repeat(2000);
    const chunks = chunkForDiscord(`${longLine}\n${longLine}`);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 1800)).toBe(true);
    expect(chunks.join("")).toContain("x".repeat(100));
  });
});
