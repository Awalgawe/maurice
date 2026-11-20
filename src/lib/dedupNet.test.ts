import { describe, it, expect } from "vitest";
import { netDayCost, netSessionTotals, netSkillShares, subtractDup, type CostSlice } from "./dedupNet";
import type { SessionMeta, TokenTotals } from "../types";

const tok = (input = 0, output = 0, cacheRead = 0, cacheCreate = 0): TokenTotals => ({ input, output, cacheRead, cacheCreate });
const slice = (over: Partial<CostSlice>): CostSlice => ({
  tokens: tok(),
  costByComponent: tok(),
  modelCost: {},
  modelTokens: {},
  skillCost: {},
  skillTokens: {},
  ...over,
});
// Only the fields the helpers read; the rest of SessionMeta is irrelevant here.
const session = (over: Partial<SessionMeta>): SessionMeta =>
  ({ estCostUSD: 0, tokens: tok(), skillCost: {}, skillTokens: {}, costByDay: {}, ...over }) as SessionMeta;

describe("subtractDup", () => {
  it("decides zero on tokens: a cost residue with zero net tokens becomes exactly 0 and the key goes", () => {
    const raw = slice({
      tokens: tok(10, 5),
      costByComponent: tok(0.30000001, 0.2),
      modelCost: { m: 0.50000001 },
      modelTokens: { m: 15 },
      skillCost: { s: 0.5, keep: 0 },
      skillTokens: { s: 15, keep: 0 },
    });
    const dup = slice({ tokens: tok(10, 5), costByComponent: tok(0.3, 0.2), modelCost: { m: 0.5 }, modelTokens: { m: 15 }, skillCost: { s: 0.5 }, skillTokens: { s: 15 } });
    const net = subtractDup(raw, dup);
    expect(net.costByComponent).toEqual(tok(0, 0, 0, 0));
    expect(net.modelCost).toEqual({});
    // A raw key the dup never touched survives, even at 0 tokens.
    expect(net.skillTokens).toEqual({ keep: 0 });
  });

  it("clamps a partial net cost at 0", () => {
    const net = subtractDup(slice({ tokens: tok(10), costByComponent: tok(0.1) }), slice({ tokens: tok(5), costByComponent: tok(0.1000001) }));
    expect(net.tokens.input).toBe(5);
    expect(net.costByComponent.input).toBe(0);
  });
});

describe("netSessionTotals / netDayCost", () => {
  it("returns raw figures for a session with no dup", () => {
    const s = session({ estCostUSD: 1.5, tokens: tok(3), costByDay: { d: 1.5 } });
    expect(netSessionTotals(s)).toEqual({ cost: 1.5, tokens: tok(3) });
    expect(netDayCost(s, "d")).toBe(1.5);
  });

  it("gates a copy-only day on that day's tokens", () => {
    const day = slice({ tokens: tok(4), costByComponent: tok(0.12345678) });
    const s = session({
      costByDay: { d: 0.12345678 },
      byDay: { d: { ...day, messageCount: 1 } as never },
      dupByDay: { d: slice({ tokens: tok(4), costByComponent: tok(0.123457) }) },
      dupCostByDay: { d: 0.123457 },
    });
    expect(netDayCost(s, "d")).toBe(0);
  });
});

describe("netSkillShares", () => {
  it("puts a session with no recorded skill under (aucun) at its net totals", () => {
    const s = session({ estCostUSD: 2, tokens: tok(7), dupCostUSD: 0.5, dupTokens: tok(2) });
    expect(netSkillShares(s)).toEqual([{ key: "(aucun)", cost: 1.5, tokens: 5 }]);
  });

  it("skips a pure copy and keeps only the skills with net tokens left in a partial one", () => {
    const pure = session({ skillTokens: { a: 10 }, skillCost: { a: 1.0000001 }, dupSkillTokens: { a: 10 }, dupSkillCost: { a: 1 } });
    expect(netSkillShares(pure)).toEqual([]);
    const partial = session({ skillTokens: { a: 10, b: 4 }, skillCost: { a: 1, b: 0.4 }, dupSkillTokens: { a: 10 }, dupSkillCost: { a: 1 } });
    expect(netSkillShares(partial)).toEqual([{ key: "b", cost: 0.4, tokens: 4 }]);
  });
});
