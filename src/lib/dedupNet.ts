import type { DupDayAgg, SessionMeta, TokenTotals } from "../types.ts";

/**
 * Net figures = a transcript's raw usage minus the part a fork copy shares with
 * the transcript that owns it (see server/dedup.ts). Shared by the client
 * aggregates and the MCP cost summary so every display site nets the same way.
 *
 * Zero is decided on tokens, never on cost. Raw cost is a float sum while the
 * dup is a sum of per-request micro-USD, so their difference leaves a residue
 * (up to ~1e-3 on a long file) that fmtCost would print as "-$0.0001". Tokens
 * are exact integers and cost derives only from them: zero net tokens ⇒ zero net
 * cost, and the key disappears. Otherwise cost is clamped at ≥ 0.
 */

export type CostSlice = DupDayAgg;

const COMPONENTS = ["input", "output", "cacheRead", "cacheCreate"] as const;

export const tokenSum = (t: TokenTotals) => t.input + t.output + t.cacheRead + t.cacheCreate;

/** Net of one cost against its token twin. */
function gate(rawCost: number, dupCost: number, netTokens: number): number {
  return netTokens <= 0 ? 0 : Math.max(0, rawCost - dupCost);
}

/** Subtract keyed maps. Only keys the dup touches can change or disappear: a raw
 *  key that legitimately holds 0 tokens and no dup is left as it was. */
function subtractKeyed(
  rawCost: Record<string, number>,
  rawTokens: Record<string, number>,
  dupCost: Record<string, number>,
  dupTokens: Record<string, number>,
): { cost: Record<string, number>; tokens: Record<string, number> } {
  const cost = { ...rawCost };
  const tokens = { ...rawTokens };
  for (const k of new Set([...Object.keys(dupCost), ...Object.keys(dupTokens)])) {
    const nt = (rawTokens[k] || 0) - (dupTokens[k] || 0);
    if (nt <= 0) {
      delete cost[k];
      delete tokens[k];
    } else {
      tokens[k] = nt;
      cost[k] = gate(rawCost[k] || 0, dupCost[k] || 0, nt);
    }
  }
  return { cost, tokens };
}

/** Net cost/token slice: per component, per model, per skill. */
export function subtractDup(raw: CostSlice, dup: CostSlice | undefined): CostSlice {
  if (!dup) return raw;
  const tokens = { ...raw.tokens };
  const costByComponent = { ...raw.costByComponent };
  for (const c of COMPONENTS) {
    tokens[c] = Math.max(0, raw.tokens[c] - dup.tokens[c]);
    costByComponent[c] = gate(raw.costByComponent[c], dup.costByComponent[c], tokens[c]);
  }
  const model = subtractKeyed(raw.modelCost, raw.modelTokens, dup.modelCost, dup.modelTokens);
  const skill = subtractKeyed(raw.skillCost, raw.skillTokens, dup.skillCost, dup.skillTokens);
  return {
    tokens,
    costByComponent,
    modelCost: model.cost,
    modelTokens: model.tokens,
    skillCost: skill.cost,
    skillTokens: skill.tokens,
  };
}

/** Whole-session net cost and tokens (Timeline lanes, Workflow pivots). */
export function netSessionTotals(s: SessionMeta): { cost: number; tokens: TokenTotals } {
  if (!s.dupTokens) return { cost: s.estCostUSD, tokens: s.tokens };
  const tokens = { ...s.tokens };
  for (const c of COMPONENTS) tokens[c] = Math.max(0, s.tokens[c] - s.dupTokens[c]);
  return { cost: gate(s.estCostUSD, s.dupCostUSD ?? 0, tokenSum(tokens)), tokens };
}

/** One local day's net cost (Dashboard daily chart), gated per component on the
 *  day's own tokens — never `costByDay[day] − dupCostByDay[day]`. */
export function netDayCost(s: SessionMeta, day: string): number {
  const raw = s.costByDay?.[day] ?? 0;
  const dup = s.dupByDay?.[day];
  const agg = s.byDay?.[day];
  if (!dup) return raw;
  if (!agg) return Math.max(0, raw - (s.dupCostByDay?.[day] ?? 0)); // pre-v22 entry: no twin to gate on
  const net = subtractDup(agg, dup);
  return COMPONENTS.reduce((a, c) => a + net.costByComponent[c], 0);
}

/**
 * The skill pivot's shares of one session, net of its copied usage.
 * - No skill recorded at all: one "(aucun)" share at the session's net totals.
 * - Skills recorded but none left once copies are subtracted: no share. The
 *   session has no turn of its own (a pure copy), so it did no skill work.
 */
export function netSkillShares(s: SessionMeta): { key: string; cost: number; tokens: number }[] {
  if (Object.keys(s.skillTokens || {}).length === 0) {
    const n = netSessionTotals(s);
    return [{ key: "(aucun)", cost: n.cost, tokens: tokenSum(n.tokens) }];
  }
  const { cost, tokens } = subtractKeyed(s.skillCost || {}, s.skillTokens, s.dupSkillCost ?? {}, s.dupSkillTokens ?? {});
  return Object.keys(tokens).map((key) => ({ key, cost: cost[key] || 0, tokens: tokens[key] || 0 }));
}
