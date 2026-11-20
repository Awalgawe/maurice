import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { computeCostSummary } from "./costSummary.ts";
import { computeDedup } from "./dedup.ts";
import { parseSession, randomReqs, transcript } from "./dedup.fixtures.ts";
import type { SessionMeta } from "../src/types.ts";

let dir: string;
let orig: SessionMeta;
let copy: SessionMeta;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "sess-costsum-"));
  const all = randomReqs("q", 300, 3, ["2026-09-01", "2026-09-02"], ["awa:actor", "awa:critic"]);
  // The owner and its copy live in two different projects (a resume from
  // another cwd): the project filter must not decide who owns the request.
  orig = { ...(await parseSession(dir, "orig", "-proj-a", transcript("o", all))), projectLabel: "alpha", projectPath: "/w/alpha" };
  copy = { ...(await parseSession(dir, "copy", "-proj-b", transcript("c", all.slice(0, 250)))), projectLabel: "beta", projectPath: "/w/beta" };
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("computeCostSummary", () => {
  it("counts each copied request once across projects", () => {
    const index = [orig, copy];
    const s = computeCostSummary(index, computeDedup(index));
    expect(s.estCostUSD).toBeCloseTo(orig.estCostUSD, 6);
    expect(s.totalTokens).toEqual(orig.tokens);
    expect(s.dupCostUSD).toBeGreaterThan(0);
    expect(s.byProject.find((p) => p.projectId === "-proj-b")!.estCostUSD).toBe(0);
  });

  it("nets a copy-only project to exactly 0 when filtered to it, with no negative or empty keys", () => {
    const index = [orig, copy];
    const s = computeCostSummary(index, computeDedup(index), "beta");
    expect(s.sessionCount).toBe(1);
    expect(s.estCostUSD).toBe(0);
    expect(s.totalTokens).toEqual({ input: 0, output: 0, cacheRead: 0, cacheCreate: 0 });
    expect(s.byModel).toEqual([]);
    expect(s.bySkill).toEqual([]);
    expect(s.byProject).toEqual([{ projectId: "-proj-b", projectLabel: "beta", estCostUSD: 0, sessions: 1 }]);
  });

  it("keeps the owner's project whole when filtered to it", () => {
    const index = [orig, copy];
    const s = computeCostSummary(index, computeDedup(index), "alpha");
    expect(s.estCostUSD).toBeCloseTo(orig.estCostUSD, 9);
    expect(s.dupCostUSD).toBe(0);
  });
});
