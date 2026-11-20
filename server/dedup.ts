import type { DupDayAgg, SessionMeta, TokenTotals } from "../src/types.ts";

/**
 * Cross-file usage dedup. A fork copy (message edit, resume or rewind into a
 * new file) re-contains the copied history, so each copied API request is
 * summed once per file holding it. The join is per request, not per file
 * relation: a copy can start after a compaction, with a different first
 * requestId than its origin (continuity.ts calls that `diverged`).
 *
 * Each requestId gets one owner: the holder with the longest `requestIds`
 * sequence, ties to the smallest session id. Every other holder accumulates its
 * OWN record of that request — never the owner's — so raw − dup is exact per
 * file, day, model and skill even when a copy's line differs from the original.
 *
 * Pure and derived from the index, never persisted (like computeContinuity).
 */

export interface SessionDup extends DupDayAgg {
  costUSD: number;
  costByDay: Record<string, number>;
  byDay: Record<string, DupDayAgg>;
  owners: Record<string, number>; // owner sessionId → USD this file shares with it
}

const emptyTok = (): TokenTotals => ({ input: 0, output: 0, cacheRead: 0, cacheCreate: 0 });
const emptySlice = (): DupDayAgg => ({
  tokens: emptyTok(),
  costByComponent: emptyTok(),
  modelCost: {},
  modelTokens: {},
  skillCost: {},
  skillTokens: {},
});

function ownsOver(a: SessionMeta, b: SessionMeta): boolean {
  const la = a.requestIds!.length;
  const lb = b.requestIds!.length;
  if (la !== lb) return la > lb;
  return a.id !== b.id ? a.id < b.id : a.projectId < b.projectId;
}

function addTo(slice: DupDayAgg, model: string | null, skill: string | null, t: number[], usd: number[]): void {
  const tok = t[0] + t[1] + t[2] + t[3];
  const cost = usd[0] + usd[1] + usd[2] + usd[3];
  slice.tokens.input += t[0];
  slice.tokens.output += t[1];
  slice.tokens.cacheRead += t[2];
  slice.tokens.cacheCreate += t[3];
  slice.costByComponent.input += usd[0];
  slice.costByComponent.output += usd[1];
  slice.costByComponent.cacheRead += usd[2];
  slice.costByComponent.cacheCreate += usd[3];
  if (model !== null) {
    slice.modelTokens[model] = (slice.modelTokens[model] || 0) + tok;
    slice.modelCost[model] = (slice.modelCost[model] || 0) + cost;
  }
  if (skill !== null) {
    slice.skillTokens[skill] = (slice.skillTokens[skill] || 0) + tok;
    slice.skillCost[skill] = (slice.skillCost[skill] || 0) + cost;
  }
}

export function computeDedup(index: SessionMeta[]): Map<string, SessionDup> {
  const owner = new Map<string, SessionMeta>();
  for (const s of index) {
    for (const id of s.requestIds ?? []) {
      const cur = owner.get(id);
      if (!cur || ownsOver(s, cur)) owner.set(id, s);
    }
  }

  const out = new Map<string, SessionDup>();
  for (const s of index) {
    const ids = s.requestIds;
    const usage = s.requestUsage;
    const dict = s.requestUsageDict;
    if (!ids || !usage || !dict || usage.length !== ids.length) continue;
    let dup: SessionDup | undefined;
    for (let i = 0; i < ids.length; i++) {
      const o = owner.get(ids[i])!;
      if (o === s) continue;
      const [dayIdx, modelIdx, skillIdx, ...rest] = usage[i];
      const t = rest.slice(0, 4);
      if (t[0] + t[1] + t[2] + t[3] === 0) continue; // empty slot (usage counted on a sidechain line)
      const usd = rest.slice(4).map((u) => u / 1e6);
      const cost = usd[0] + usd[1] + usd[2] + usd[3];
      dup ??= { ...emptySlice(), costUSD: 0, costByDay: {}, byDay: {}, owners: {} };
      const model = modelIdx >= 0 ? dict.models[modelIdx] : null;
      const skill = skillIdx >= 0 ? dict.skills[skillIdx] : null;
      addTo(dup, model, skill, t, usd);
      dup.costUSD += cost;
      dup.owners[o.id] = (dup.owners[o.id] || 0) + cost;
      if (dayIdx >= 0) {
        const day = dict.days[dayIdx];
        dup.costByDay[day] = (dup.costByDay[day] || 0) + cost;
        addTo((dup.byDay[day] ??= emptySlice()), model, skill, t, usd);
      }
    }
    if (dup) out.set(s.id, dup);
  }
  return out;
}

// Identity memo: it only hits for callers sharing one getIndex() result (a
// coalesced rebuild, or one handler calling twice), since every getIndex() call
// returns a fresh array. A miss costs ~10 ms at ~47k requests.
let memo: { src: SessionMeta[]; dedup: Map<string, SessionDup> } | null = null;

export function dedupFor(index: SessionMeta[]): Map<string, SessionDup> {
  if (memo?.src !== index) memo = { src: index, dedup: computeDedup(index) };
  return memo.dedup;
}

/** The list-row fields of one session's dup (see SessionMeta.dup*). */
export function dupRowFields(d: SessionDup | undefined): Partial<SessionMeta> {
  if (!d) return {};
  return {
    dupCostUSD: d.costUSD,
    dupTokens: d.tokens,
    dupSkillCost: d.skillCost,
    dupSkillTokens: d.skillTokens,
    dupCostByDay: d.costByDay,
    dupByDay: d.byDay,
  };
}
