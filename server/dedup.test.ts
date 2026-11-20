import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { computeDedup, dupRowFields } from "./dedup.ts";
import { parseSession, randomReqs, transcript, type Req } from "./dedup.fixtures.ts";
import { subtractDup, tokenSum, netSessionTotals, netDayCost, netSkillShares } from "../src/lib/dedupNet.ts";
import type { SessionMeta, TokenTotals } from "../src/types.ts";

let dir: string;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "sess-dedup-"));
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const P = "-tmp-proj";
const req = (id: string, day: string, t: Req["t"], skill = "awa:actor"): Req => ({ id, ts: `${day}T12:00:00Z`, skill, t });
const parse = (id: string, tag: string, reqs: Req[]) => parseSession(dir, id, P, transcript(tag, reqs));

/** The session slice used by aggregates, netted through subtractDup. */
function netSlice(s: SessionMeta, dedup: ReturnType<typeof computeDedup>) {
  return subtractDup(
      { tokens: s.tokens, costByComponent: s.costByComponent, modelCost: s.modelCost, modelTokens: s.modelTokens, skillCost: s.skillCost, skillTokens: s.skillTokens },
      dedup.get(s.id),
  );
}
const cost = (c: TokenTotals) => c.input + c.output + c.cacheRead + c.cacheCreate;

/** Sum of every distinct request over the given transcripts, from one holder each. */
function uniqueTotals(...metas: SessionMeta[]) {
  const seen = new Set<string>();
  let tokens = 0;
  let usd = 0;
  for (const m of metas) {
    m.requestIds!.forEach((id, i) => {
      if (seen.has(id)) return;
      seen.add(id);
      const r = m.requestUsage![i];
      tokens += r[3] + r[4] + r[5] + r[6];
      usd += (r[7] + r[8] + r[9] + r[10]) / 1e6;
    });
  }
  return { tokens, usd };
}

describe("computeDedup", () => {
  it("strict-prefix copy: the longer file owns, the prefix nets to its own part only", async () => {
    const shared = [req("r1", "2026-09-01", [100, 10, 1000, 50]), req("r2", "2026-09-01", [200, 20, 2000, 60])];
    const orig = await parse("bbbb", "o", [...shared, req("r3", "2026-09-02", [300, 30, 3000, 70])]);
    const copy = await parse("aaaa", "c", [...shared]);
    const dedup = computeDedup([copy, orig]);
    expect(dedup.has("bbbb")).toBe(false);
    const d = dedup.get("aaaa")!;
    expect(tokenSum(d.tokens)).toBe(tokenSum(copy.tokens));
    expect(d.owners).toEqual({ bbbb: d.costUSD });
    const u = uniqueTotals(orig, copy);
    const netTok = tokenSum(netSlice(orig, dedup).tokens) + tokenSum(netSlice(copy, dedup).tokens);
    expect(netTok).toBe(u.tokens);
  });

  it("diverged copy (shared middle, different first requestId): only the shared middle is dup", async () => {
    // Like 84ddfbc0: the copy's history starts after a compaction, so its first
    // requestId is not the origin's — continuity calls it diverged.
    const orig = await parse("o2", "o", [
      req("x0", "2026-09-01", [11, 1, 0, 0]),
      req("m1", "2026-09-01", [12, 2, 0, 0]),
      req("m2", "2026-09-02", [13, 3, 0, 0]),
      req("x3", "2026-09-02", [14, 4, 0, 0]),
    ]);
    const copy = await parse("c2", "c", [
      req("y0", "2026-09-03", [21, 1, 0, 0]),
      req("m1", "2026-09-01", [12, 2, 0, 0]),
      req("m2", "2026-09-02", [13, 3, 0, 0]),
    ]);
    const dedup = computeDedup([orig, copy]);
    expect(dedup.has("o2")).toBe(false);
    expect(tokenSum(dedup.get("c2")!.tokens)).toBe(12 + 2 + 13 + 3);
    expect(tokenSum(netSlice(copy, dedup).tokens)).toBe(21 + 1);
  });

  it("identical copy: the tie goes to the smallest session id, whatever the index order", async () => {
    const reqs = [req("i1", "2026-09-01", [5, 5, 5, 5]), req("i2", "2026-09-01", [6, 6, 6, 6])];
    const a = await parse("id-a", "a", reqs);
    const b = await parse("id-b", "b", reqs);
    for (const order of [[a, b], [b, a]]) {
      const dedup = computeDedup(order);
      expect([...dedup.keys()]).toEqual(["id-b"]);
      expect(dedup.get("id-b")!.owners).toEqual({ "id-a": expect.any(Number) });
    }
  });

  it("subtracts the holder's own record, not the owner's (copy line differs in day and skill)", async () => {
    const orig = await parse("o4", "o", [
      req("s1", "2026-09-01", [100, 10, 0, 0], "skill-orig"),
      req("s2", "2026-09-01", [1, 1, 0, 0]),
      req("s3", "2026-09-01", [1, 1, 0, 0]),
    ]);
    const copy = await parse("c4", "c", [req("s1", "2026-09-05", [100, 10, 0, 0], "skill-copy"), req("own", "2026-09-06", [7, 7, 0, 0], "skill-own")]);
    const dedup = computeDedup([orig, copy]);
    const d = dedup.get("c4")!;
    expect(Object.keys(d.skillTokens)).toEqual(["skill-copy"]);
    const copyDay = Object.keys(copy.byDay!).find((day) => copy.byDay![day].skillTokens["skill-copy"]);
    expect(Object.keys(d.byDay)).toEqual([copyDay]);
    // Net per skill and per day: the copy's shared skill and day are gone, the
    // original's skill was never in this file.
    const net = netSlice(copy, dedup);
    expect(Object.keys(net.skillTokens)).toEqual(["skill-own"]);
    for (const [day, agg] of Object.entries(copy.byDay!)) {
      const nd = subtractDup(agg, d.byDay[day]);
      expect(tokenSum(nd.tokens)).toBe(day === copyDay ? 0 : 14);
    }
  });

  it("leaves a session with no shared request out of the map", async () => {
    const a = await parse("solo", "s", [req("solo1", "2026-09-01", [1, 2, 3, 4])]);
    const b = await parse("other", "t", [req("other1", "2026-09-01", [1, 2, 3, 4])]);
    expect(computeDedup([a, b]).size).toBe(0);
  });

  it("a full copy nets to exactly 0 at every level, where a 1e-6 cost clamp would not", async () => {
    const days = ["2026-09-01", "2026-09-02", "2026-09-03"];
    const skills = ["awa:actor", "awa:critic", "(aucun)"];
    const all = randomReqs("big", 650, 42, days, skills);
    const orig = await parse("orig-big", "o", all);
    const copy = await parse("copy-big", "c", all.slice(0, 600)); // a60f3ba5: 0 own
    const dedup = computeDedup([orig, copy]);
    const d = dedup.get("copy-big")!;

    // The fixture is meaningful: raw float sum vs summed micro-USD differ by more
    // than any 1e-6 clamp would hide.
    expect(Math.abs(copy.estCostUSD - d.costUSD)).toBeGreaterThan(1e-6);

    const net = netSlice(copy, dedup);
    expect(cost(net.costByComponent)).toBe(0);
    expect(tokenSum(net.tokens)).toBe(0);
    expect(net.modelCost).toEqual({});
    expect(net.skillCost).toEqual({});
    for (const [day, agg] of Object.entries(copy.byDay!)) {
      expect(cost(subtractDup(agg, d.byDay[day]).costByComponent)).toBe(0);
    }

    // The client helpers on the list row.
    const row = { ...copy, ...dupRowFields(d) };
    expect(netSessionTotals(row).cost).toBe(0);
    for (const day of Object.keys(copy.costByDay)) expect(netDayCost(row, day)).toBe(0);
    expect(netSkillShares(row)).toEqual([]);
  });

  it("a partial copy is never negative and the totals count each request once", async () => {
    const days = ["2026-09-01", "2026-09-02"];
    const skills = ["awa:actor", "awa:critic"];
    const all = randomReqs("p", 400, 7, days, skills);
    const orig = await parse("orig-p", "o", all);
    const copy = await parse("copy-p", "c", [...all.slice(0, 300), ...randomReqs("own", 40, 9, days, skills)]);
    const dedup = computeDedup([orig, copy]);
    const net = netSlice(copy, dedup);
    for (const v of [...Object.values(net.costByComponent), ...Object.values(net.modelCost), ...Object.values(net.skillCost)]) {
      expect(v).toBeGreaterThanOrEqual(0);
    }
    const u = uniqueTotals(orig, copy);
    const netOrig = netSlice(orig, dedup);
    expect(tokenSum(netOrig.tokens) + tokenSum(net.tokens)).toBe(u.tokens);
    expect(cost(netOrig.costByComponent) + cost(net.costByComponent)).toBeCloseTo(u.usd, 3);
  });
});
