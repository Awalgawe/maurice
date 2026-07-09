import { describe, it, expect } from "vitest";
import { computeFacets } from "./facets.ts";
import type { SessionMeta } from "../src/types.ts";

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

describe("computeFacets", () => {
  it("counts projects by id, keeping the label, sorted by count desc", () => {
    const facets = computeFacets([
      session({ projectId: "a", projectLabel: "Alpha" }),
      session({ projectId: "a", projectLabel: "Alpha" }),
      session({ projectId: "b", projectLabel: "Beta" }),
    ]);
    expect(facets.projects).toEqual([
      { value: "a", label: "Alpha", count: 2 },
      { value: "b", label: "Beta", count: 1 },
    ]);
  });

  it("tallies array facets (skills, branches, models, mcpTools) across sessions", () => {
    const facets = computeFacets([
      session({ skills: ["x", "y"], branches: ["main"], models: ["opus"], mcpTools: ["t1"] }),
      session({ skills: ["x"], branches: ["main"], models: ["sonnet"], mcpTools: [] }),
    ]);
    expect(facets.skills).toEqual([
      { value: "x", count: 2 },
      { value: "y", count: 1 },
    ]);
    expect(facets.branches).toEqual([{ value: "main", count: 2 }]);
    expect(facets.mcpTools).toEqual([{ value: "t1", count: 1 }]);
  });

  it("only counts non-null tickets", () => {
    const facets = computeFacets([
      session({ ticket: "WMP-1" }),
      session({ ticket: null }),
      session({ ticket: "WMP-1" }),
    ]);
    expect(facets.tickets).toEqual([{ value: "WMP-1", count: 2 }]);
  });
});
