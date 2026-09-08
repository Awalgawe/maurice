import { describe, it, expect } from "vitest";
import { computeContinuity } from "./continuity.ts";
import type { SessionMeta } from "../src/types.ts";

function session(id: string, requestIds: string[] | undefined, partial: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id,
    projectId: "p",
    projectPath: "/tmp/p",
    projectLabel: "p",
    ticket: null,
    branches: [],
    skills: [],
    models: [],
    entrypoints: [],
    messageCount: (requestIds?.length ?? 0) * 2,
    start: null,
    end: null,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 },
    estCostUSD: 0,
    costByDay: {},
    activeDays: [],
    activityHeat: {},
    costByComponent: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 },
    peakContextTokens: 0,
    peakContextPct: 0,
    errorCount: 0,
    hasErrors: false,
    errors: [],
    cacheRewriteCount: 0,
    cacheRewriteWastedUSD: 0,
    cacheRewriteWastedTokens: 0,
    mcpTools: [],
    subagentCount: 0,
    firstUserPrompt: null,
    skillTokens: {},
    skillCost: {},
    modelTokens: {},
    modelCost: {},
    requestIds,
    ...partial,
  };
}

const ids = (n: number) => Array.from({ length: n }, (_, i) => `req_${i}`);

describe("computeContinuity", () => {
  it("links a truncated transcript to the one that carried the conversation on", () => {
    const fragment = session("a", ids(16));
    const full = session("b", ids(67), { aiTitle: "Audit MR 631" });
    const c = computeContinuity([fragment, full], fragment);
    expect(c).not.toBeNull();
    expect(c!.lineageId).toBe("req_0");
    expect(c!.continuedIn.map((r) => r.sessionId)).toEqual(["b"]);
    expect(c!.continuedIn[0].title).toBe("Audit MR 631");
    expect(c!.continuedIn[0].requestCount).toBe(67);
    expect(c!.continuedFrom).toEqual([]);
  });

  it("labels a titleless transcript with nothing rather than the shared first prompt", () => {
    const fragment = session("a", ids(16), { firstUserPrompt: "go" });
    const full = session("b", ids(67), { firstUserPrompt: "go" });
    const c = computeContinuity([fragment, full], fragment)!;
    expect(c.continuedIn[0].title).toBeNull();
  });

  it("is symmetric: the continuation points back at the fragment", () => {
    const fragment = session("a", ids(16));
    const full = session("b", ids(67));
    const c = computeContinuity([fragment, full], full);
    expect(c!.continuedFrom.map((r) => r.sessionId)).toEqual(["a"]);
    expect(c!.continuedIn).toEqual([]);
  });

  it("orders continuations nearest-first and origins nearest-last-fork-first", () => {
    const chain = [session("a", ids(5)), session("b", ids(10)), session("c", ids(20)), session("d", ids(40))];
    const fromB = computeContinuity(chain, chain[1])!;
    expect(fromB.continuedIn.map((r) => r.sessionId)).toEqual(["c", "d"]);
    expect(fromB.continuedFrom.map((r) => r.sessionId)).toEqual(["a"]);
    const fromD = computeContinuity(chain, chain[3])!;
    expect(fromD.continuedFrom.map((r) => r.sessionId)).toEqual(["c", "b", "a"]);
  });

  it("reports an incomparable sequence as diverged, never as a continuation", () => {
    const a = session("a", ["req_0", "req_1", "req_2"]);
    const b = session("b", ["req_0", "req_1", "req_9", "req_10"]);
    const c = computeContinuity([a, b], a)!;
    expect(c.continuedIn).toEqual([]);
    expect(c.continuedFrom).toEqual([]);
    expect(c.diverged.map((r) => r.sessionId)).toEqual(["b"]);
  });

  it("reports an identical sequence as a duplicate copy", () => {
    const a = session("a", ids(34));
    const b = session("b", ids(34));
    const c = session("c", ids(47));
    const fromA = computeContinuity([a, b, c], a)!;
    expect(fromA.duplicates.map((r) => r.sessionId)).toEqual(["b"]);
    expect(fromA.continuedIn.map((r) => r.sessionId)).toEqual(["c"]);
  });

  it("never joins two conversations that merely look alike", () => {
    // Same length, same message counts — but not one shared API request.
    const a = session("a", ["req_a1", "req_a2"]);
    const b = session("b", ["req_b1", "req_b2"]);
    expect(computeContinuity([a, b], a)).toBeNull();
  });

  it("returns null when the transcript has no recorded API request", () => {
    const a = session("a", []);
    const b = session("b", ids(5));
    expect(computeContinuity([a, b], a)).toBeNull();
    // …and pre-v24 cache entries (field absent) are inert on both sides.
    const legacy = session("c", undefined);
    expect(computeContinuity([legacy, b], legacy)).toBeNull();
    expect(computeContinuity([legacy, b], b)).toBeNull();
  });
});
