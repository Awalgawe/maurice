import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseSession, transcript } from "../dedup.fixtures.ts";
import { estimateCostByComponent } from "../pricing.ts";

/**
 * requestUsage is what the cross-file dedup subtracts from a copy: it must stay
 * index-aligned with requestIds and hold that request's usage exactly once.
 */

let dir: string;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "sess-requsage-"));
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("requestUsage in buildMetaAndDocs", () => {
  it("is aligned with requestIds and matches each request's tokens and cost, siblings once", async () => {
    const meta = await parseSession(
      dir,
      "s1",
      "-tmp-proj",
      transcript("s1", [
        { id: "r1", ts: "2026-09-08T12:00:00Z", skill: "awa:actor", model: "claude-sonnet-4-6", t: [1234, 567, 8910, 1112], siblings: 2 },
        { id: "r2", ts: "2026-09-09T12:00:00Z", model: "claude-opus-4-1", t: [10, 20, 30, 40] },
      ]),
    );
    expect(meta.requestIds).toEqual(["r1", "r2"]);
    const u = meta.requestUsage!;
    const dict = meta.requestUsageDict!;
    expect(u).toHaveLength(2);
    expect(u[0].slice(3, 7)).toEqual([1234, 567, 8910, 1112]);
    expect(dict.models[u[0][1]]).toBe("claude-sonnet-4-6");
    expect(dict.skills[u[0][2]]).toBe("awa:actor");
    expect(dict.skills[u[1][2]]).toBe("(aucun)");
    expect(Object.keys(meta.byDay!)).toContain(dict.days[u[1][0]]);
    const c = estimateCostByComponent("claude-sonnet-4-6", { input: 1234, output: 567, cacheRead: 8910, cacheCreate: 1112 }, null);
    expect(u[0].slice(7)).toEqual([c.input, c.output, c.cacheRead, c.cacheCreate].map((v) => Math.round(v * 1e6)));
    // The three sibling lines were counted once, in the totals and in the record.
    expect(meta.tokens.input).toBe(1234 + 10);
  });

  it("keeps a zero slot for a requestId whose usage was first counted on a sidechain line", async () => {
    const side = transcript("sc", [{ id: "r1", ts: "2026-09-08T12:00:00Z", t: [50, 5, 0, 0], sidechain: true }]);
    const main = transcript("mn", [
      { id: "r1", ts: "2026-09-08T12:01:00Z", t: [50, 5, 0, 0] },
      { id: "r2", ts: "2026-09-08T12:02:00Z", t: [60, 6, 0, 0] },
    ]);
    const meta = await parseSession(dir, "s2", "-tmp-proj", [...side, ...main]);
    expect(meta.requestIds).toEqual(["r1", "r2"]);
    expect(meta.requestUsage![0]).toEqual([-1, -1, -1, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(meta.requestUsage![1].slice(3, 7)).toEqual([60, 6, 0, 0]);
    expect(meta.tokens.input).toBe(50 + 60);
  });
});
