import { subtractDup } from "../src/lib/dedupNet.ts";
import type { SessionDup } from "./dedup.ts";
import type { SessionMeta, TokenTotals } from "../src/types.ts";

/**
 * The MCP `cost_summary` aggregate, net of fork copies: each copied request is
 * counted once, under its owner. `dedup` must come from the WHOLE index — a
 * copy's owner may sit outside the project filter — and the filter runs after.
 * Every session is netted through subtractDup, so a project holding only copies
 * sums to exactly 0, never to a rounding residue.
 */
export function computeCostSummary(index: SessionMeta[], dedup: Map<string, SessionDup>, project?: string) {
  let rows = index;
  if (project) {
    const p = project.toLowerCase();
    rows = rows.filter(
      (s) =>
        s.projectId.toLowerCase().includes(p) ||
        s.projectLabel.toLowerCase().includes(p) ||
        s.projectPath.toLowerCase().includes(p),
    );
  }

  const totalTokens: TokenTotals = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 };
  let totalCost = 0;
  let dupCostUSD = 0;
  let earliest: string | null = null;
  let latest: string | null = null;
  const byModel = new Map<string, number>();
  const bySkill = new Map<string, number>();
  const byProject = new Map<string, { label: string; cost: number; sessions: number }>();

  for (const s of rows) {
    const d = dedup.get(s.id);
    const net = subtractDup(
      {
        tokens: s.tokens,
        costByComponent: s.costByComponent,
        modelCost: s.modelCost,
        modelTokens: s.modelTokens,
        skillCost: s.skillCost,
        skillTokens: s.skillTokens,
      },
      d,
    );
    const cost = net.costByComponent.input + net.costByComponent.output + net.costByComponent.cacheRead + net.costByComponent.cacheCreate;
    totalTokens.input += net.tokens.input;
    totalTokens.output += net.tokens.output;
    totalTokens.cacheRead += net.tokens.cacheRead;
    totalTokens.cacheCreate += net.tokens.cacheCreate;
    totalCost += cost;
    dupCostUSD += d?.costUSD ?? 0;
    if (s.start && (!earliest || s.start < earliest)) earliest = s.start;
    if (s.end && (!latest || s.end > latest)) latest = s.end;
    for (const [m, c] of Object.entries(net.modelCost)) byModel.set(m, (byModel.get(m) ?? 0) + c);
    for (const [sk, c] of Object.entries(net.skillCost)) bySkill.set(sk, (bySkill.get(sk) ?? 0) + c);
    const pj = byProject.get(s.projectId) ?? { label: s.projectLabel, cost: 0, sessions: 0 };
    pj.cost += cost;
    pj.sessions += 1;
    byProject.set(s.projectId, pj);
  }

  const ranked = (m: Map<string, number>) =>
    [...m.entries()].map(([key, costUSD]) => ({ key, costUSD })).sort((a, b) => b.costUSD - a.costUSD);

  return {
    sessionCount: rows.length,
    periodStart: earliest,
    periodEnd: latest,
    totalTokens,
    estCostUSD: totalCost,
    dupCostUSD,
    byModel: ranked(byModel),
    bySkill: ranked(bySkill),
    byProject: [...byProject.entries()]
      .map(([projectId, v]) => ({ projectId, projectLabel: v.label, estCostUSD: v.cost, sessions: v.sessions }))
      .sort((a, b) => b.estCostUSD - a.estCostUSD),
  };
}
