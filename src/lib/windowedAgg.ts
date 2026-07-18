import type { DayAgg, TokenTotals } from "../types";

/** A session's decomposable metrics summed over the days within a window. */
export interface WindowedTotals {
  cost: number;
  tokens: TokenTotals;
  costByComponent: TokenTotals;
  errorCount: number;
  turnCount: number;
  turnDurationMs: number;
  apiRetryCount: number;
  apiErrorMessageCount: number;
  interruptionCount: number;
  messageCount: number;
  modelCost: Record<string, number>;
  modelTokens: Record<string, number>;
  skillCost: Record<string, number>;
  skillTokens: Record<string, number>;
  toolCounts: Record<string, number>;
  toolErrors: Record<string, number>;
  mcpTools: Record<string, number>;
  denialCounts: Record<string, number>;
  promptCounts: Record<string, number>;
  heat: Record<string, number>; // slot = dow*24+hour (Monday-first, local) → count
}

const emptyTok = (): TokenTotals => ({ input: 0, output: 0, cacheRead: 0, cacheCreate: 0 });

function addTok(dst: TokenTotals, src: TokenTotals): void {
  dst.input += src.input;
  dst.output += src.output;
  dst.cacheRead += src.cacheRead;
  dst.cacheCreate += src.cacheCreate;
}

function addMap(dst: Record<string, number>, src: Record<string, number>): void {
  for (const [k, v] of Object.entries(src)) dst[k] = (dst[k] || 0) + v;
}

// Monday-first weekday (0=Mon..6=Sun) of a local "YYYY-MM-DD".
function dowOf(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return (new Date(y, m - 1, d).getDay() + 6) % 7;
}

/**
 * Sum a session's per-day breakdown over the days on/after `cutoffDay`
 * ("YYYY-MM-DD"), or over all days when `cutoffDay` is null. Lets the Dashboard
 * window every decomposable KPI on the same period as the daily charts, instead
 * of counting a whole session because its last activity landed in the window.
 */
export function windowSession(
  byDay: Record<string, DayAgg> | undefined,
  cutoffDay: string | null,
): WindowedTotals {
  const out: WindowedTotals = {
    cost: 0,
    tokens: emptyTok(),
    costByComponent: emptyTok(),
    errorCount: 0,
    turnCount: 0,
    turnDurationMs: 0,
    apiRetryCount: 0,
    apiErrorMessageCount: 0,
    interruptionCount: 0,
    messageCount: 0,
    modelCost: {},
    modelTokens: {},
    skillCost: {},
    skillTokens: {},
    toolCounts: {},
    toolErrors: {},
    mcpTools: {},
    denialCounts: {},
    promptCounts: {},
    heat: {},
  };
  if (!byDay) return out;
  for (const [day, agg] of Object.entries(byDay)) {
    if (cutoffDay && day < cutoffDay) continue;
    addTok(out.tokens, agg.tokens);
    addTok(out.costByComponent, agg.costByComponent);
    out.cost += agg.costByComponent.input + agg.costByComponent.output + agg.costByComponent.cacheRead + agg.costByComponent.cacheCreate;
    out.errorCount += agg.errorCount;
    out.turnCount += agg.turnCount;
    out.turnDurationMs += agg.turnDurationMs;
    out.apiRetryCount += agg.apiRetryCount;
    out.apiErrorMessageCount += agg.apiErrorMessageCount;
    out.interruptionCount += agg.interruptionCount;
    out.messageCount += agg.messageCount;
    addMap(out.modelCost, agg.modelCost);
    addMap(out.modelTokens, agg.modelTokens);
    addMap(out.skillCost, agg.skillCost);
    addMap(out.skillTokens, agg.skillTokens);
    addMap(out.toolCounts, agg.toolCounts);
    addMap(out.toolErrors, agg.toolErrors);
    addMap(out.mcpTools, agg.mcpTools);
    addMap(out.denialCounts, agg.denialCounts);
    addMap(out.promptCounts, agg.promptCounts);
    const dow = dowOf(day);
    for (const [hour, count] of Object.entries(agg.heatByHour)) {
      const slot = dow * 24 + Number(hour);
      out.heat[slot] = (out.heat[slot] || 0) + count;
    }
  }
  return out;
}
