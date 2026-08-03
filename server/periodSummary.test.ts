import { describe, it, expect } from "vitest";
import { computePeriodSummary } from "./periodSummary.ts";
import type { DayAgg, SessionMeta } from "../src/types.ts";

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

function session(partial: Partial<SessionMeta>): SessionMeta {
  return {
    id: "s",
    projectId: "p",
    projectPath: "/tmp/p",
    projectLabel: "p",
    ticket: null,
    branches: [],
    skills: [],
    models: [],
    entrypoints: [],
    messageCount: 0,
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
    ...partial,
  };
}

describe("computePeriodSummary", () => {
  it("counts only the days inside the range for a session straddling a bound", () => {
    const index = [
      session({
        id: "a",
        start: "2026-01-01T10:00:00Z",
        byDay: {
          "2026-01-01": mkDay({ interruptionCount: 5, errorCount: 1 }),
          "2026-01-09": mkDay({ interruptionCount: 2, errorCount: 4 }),
        },
      }),
    ];

    const all = computePeriodSummary(index);
    expect(all.friction.interruptionCount).toBe(7);
    expect(all.activeDays).toBe(2);

    const windowed = computePeriodSummary(index, { from: "2026-01-01", to: "2026-01-05" });
    expect(windowed.sessionCount).toBe(1);
    expect(windowed.friction.interruptionCount).toBe(5);
    expect(windowed.friction.errorCount).toBe(1);
    expect(windowed.activeDays).toBe(1);
  });

  it("excludes a session with no day in the range", () => {
    const index = [session({ id: "a", start: "2026-01-01T10:00:00Z", byDay: { "2026-01-01": mkDay({ errorCount: 3 }) } })];
    const out = computePeriodSummary(index, { from: "2026-02-01", to: "2026-02-28" });
    expect(out.sessionCount).toBe(0);
    expect(out.friction.errorCount).toBe(0);
    expect(out.sessionsMissingByDay).toBe(0);
  });

  it("merges per-key friction maps and splits totals by project", () => {
    const index = [
      session({
        id: "a",
        projectId: "proj-a",
        projectLabel: "a",
        byDay: {
          "2026-01-02": mkDay({
            denialCounts: { tool_use: 2 },
            toolErrors: { Bash: 1 },
            costByComponent: { input: 1, output: 0, cacheRead: 0, cacheCreate: 0 },
          }),
        },
      }),
      session({
        id: "b",
        projectId: "proj-b",
        projectLabel: "b",
        byDay: {
          "2026-01-02": mkDay({
            denialCounts: { tool_use: 1, other: 4 },
            toolErrors: { Bash: 2, Edit: 1 },
            costByComponent: { input: 5, output: 0, cacheRead: 0, cacheCreate: 0 },
          }),
        },
      }),
    ];

    const out = computePeriodSummary(index, { from: "2026-01-01", to: "2026-01-31" });
    expect(out.friction.denialCounts).toEqual({ tool_use: 3, other: 4 });
    expect(out.friction.toolErrors).toEqual({ Bash: 3, Edit: 1 });
    // byProject is ranked by windowed cost, so the pricier project comes first.
    expect(out.byProject.map((p) => p.projectId)).toEqual(["proj-b", "proj-a"]);
    expect(out.byProject[0].friction.denialCounts).toEqual({ tool_use: 1, other: 4 });
    expect(out.estCostUSD).toBeCloseTo(6);
  });

  it("filters on a project substring across id, label and path", () => {
    const index = [
      session({ id: "a", projectId: "boxoffice-boapp", projectLabel: "boapp", byDay: { "2026-01-02": mkDay({ errorCount: 1 }) } }),
      session({ id: "b", projectId: "awalgawe-maurice", projectLabel: "maurice", byDay: { "2026-01-02": mkDay({ errorCount: 9 }) } }),
    ];
    const out = computePeriodSummary(index, { project: "maurice" });
    expect(out.sessionCount).toBe(1);
    expect(out.friction.errorCount).toBe(9);
  });

  it("reports sessions that predate the per-day breakdown instead of dropping them silently", () => {
    const index = [
      session({ id: "old", start: "2026-01-02T08:00:00Z", byDay: undefined, errorCount: 12 }),
      session({ id: "new", start: "2026-01-02T09:00:00Z", byDay: { "2026-01-02": mkDay({ errorCount: 1 }) } }),
    ];
    const out = computePeriodSummary(index, { from: "2026-01-01", to: "2026-01-31" });
    expect(out.sessionCount).toBe(1);
    expect(out.sessionsMissingByDay).toBe(1);
    // The un-windowable session contributes nothing — the count is the warning.
    expect(out.friction.errorCount).toBe(1);
  });

  it("keeps undated scalars apart and attributes them by session start", () => {
    const index = [
      session({
        id: "a",
        start: "2026-01-02T08:00:00Z",
        byDay: { "2026-01-02": mkDay({ errorCount: 1 }) },
        permissionModeChanges: 3,
        compactCount: 2,
        hookErrorCount: 1,
        permissionModes: ["acceptEdits", "default"],
      }),
    ];
    const out = computePeriodSummary(index, { from: "2026-01-01", to: "2026-01-31" });
    expect(out.undated).toEqual({
      permissionModeChanges: 3,
      compactCount: 2,
      hookErrorCount: 1,
      permissionModes: ["acceptEdits", "default"],
    });
    expect(out.friction).not.toHaveProperty("permissionModeChanges");
  });

  it("ranks sessions by friction weight so the noisiest can be read first", () => {
    const index = [
      session({ id: "calm", byDay: { "2026-01-02": mkDay({ errorCount: 1 }) } }),
      session({ id: "noisy", byDay: { "2026-01-02": mkDay({ interruptionCount: 4, denialCounts: { tool_use: 3 } }) } }),
    ];
    const out = computePeriodSummary(index);
    expect(out.sessions.map((s) => s.id)).toEqual(["noisy", "calm"]);
    expect(out.sessions[0].frictionScore).toBe(7);
  });
});
