import { describe, it, expect } from "vitest";
import { windowSession } from "./windowedAgg";
import type { DayAgg } from "../types";

const mkDay = (over: Partial<DayAgg>): DayAgg => ({
  tokens: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 },
  costByComponent: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 },
  messageCount: 0,
  errorCount: 0,
  turnCount: 0,
  turnDurationMs: 0,
  apiRetryCount: 0,
  apiErrorMessageCount: 0,
  interruptionCount: 0,
  modelCost: {},
  modelTokens: {},
  skillCost: {},
  skillTokens: {},
  toolCounts: {},
  toolErrors: {},
  mcpTools: {},
  denialCounts: {},
  promptCounts: {},
  heatByHour: {},
  ...over,
});

const byDay: Record<string, DayAgg> = {
  "2026-01-01": mkDay({
    costByComponent: { input: 1, output: 0, cacheRead: 0, cacheCreate: 0 },
    tokens: { input: 10, output: 0, cacheRead: 0, cacheCreate: 0 },
    errorCount: 2,
  }),
  "2026-01-05": mkDay({
    costByComponent: { input: 0, output: 2, cacheRead: 0, cacheCreate: 0 },
    tokens: { input: 0, output: 20, cacheRead: 0, cacheCreate: 0 },
    errorCount: 3,
  }),
};

describe("windowSession", () => {
  it("sums all days when the cutoff is null", () => {
    const w = windowSession(byDay, null);
    expect(w.cost).toBeCloseTo(3);
    expect(w.tokens.input).toBe(10);
    expect(w.tokens.output).toBe(20);
    expect(w.errorCount).toBe(5);
  });

  it("excludes days before the cutoff", () => {
    const w = windowSession(byDay, "2026-01-03");
    expect(w.cost).toBeCloseTo(2);
    expect(w.errorCount).toBe(3);
    expect(w.tokens.input).toBe(0);
    expect(w.tokens.output).toBe(20);
  });

  it("excludes days after the upper bound", () => {
    const w = windowSession(byDay, null, "2026-01-03");
    expect(w.cost).toBeCloseTo(1);
    expect(w.errorCount).toBe(2);
    expect(w.tokens.input).toBe(10);
    expect(w.tokens.output).toBe(0);
  });

  it("keeps only the days inside a closed range, bounds included", () => {
    expect(windowSession(byDay, "2026-01-01", "2026-01-05").errorCount).toBe(5);
    expect(windowSession(byDay, "2026-01-02", "2026-01-04").errorCount).toBe(0);
    expect(windowSession(byDay, "2026-01-05", "2026-01-05").errorCount).toBe(3);
  });

  it("maps heatByHour to Monday-first dow*24+hour slots", () => {
    // 2026-01-01 is a Thursday → Monday-first weekday index 3.
    const bd = { "2026-01-01": mkDay({ heatByHour: { "9": 4 } }) };
    const w = windowSession(bd, null);
    expect(w.heat[String(3 * 24 + 9)]).toBe(4);
  });

  it("returns zeros for an undefined byDay", () => {
    const w = windowSession(undefined, null);
    expect(w.cost).toBe(0);
    expect(Object.keys(w.heat)).toHaveLength(0);
  });
});
