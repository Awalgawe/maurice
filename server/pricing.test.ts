import { describe, it, expect } from "vitest";
import { contextWindowFor, estimateCost, estimateCostByComponent } from "./pricing.ts";

const bundle = { input: 1_000_000, output: 1_000_000, cacheRead: 0, cacheCreate: 0 };

describe("estimateCost", () => {
  it("prices Opus higher than Sonnet for the same bundle", () => {
    expect(estimateCost("claude-opus-4-8", bundle)).toBeGreaterThan(
      estimateCost("claude-sonnet-4-6", bundle),
    );
  });

  it("prices Fable above Opus", () => {
    expect(estimateCost("claude-fable-5", bundle)).toBeGreaterThan(
      estimateCost("claude-opus-4-8", bundle),
    );
  });

  it("sums each token class by its own rate", () => {
    // Sonnet: input 3 + output 15 per Mtok → 18 USD for 1M each.
    expect(estimateCost("claude-sonnet-4-6", bundle)).toBeCloseTo(18, 6);
  });

  it("prices Opus 4.x at the $5/$25 tier", () => {
    // input 5 + output 25 per Mtok → 30 USD for 1M each. Not the legacy $15/$75.
    expect(estimateCost("claude-opus-4-8", bundle)).toBeCloseTo(30, 6);
  });

  it("prices Fable 5 at the $10/$50 tier", () => {
    // input 10 + output 50 per Mtok → 60 USD for 1M each.
    expect(estimateCost("claude-fable-5", bundle)).toBeCloseTo(60, 6);
  });

  it("falls back to Sonnet pricing for an unknown model", () => {
    expect(estimateCost("some-future-model", bundle)).toBe(
      estimateCost("claude-sonnet-4-6", bundle),
    );
  });

  it("returns 0 for an empty bundle", () => {
    expect(estimateCost("claude-opus-4-8", { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 })).toBe(0);
  });
});

describe("contextWindowFor", () => {
  it("gives Fable a 1M window", () => {
    expect(contextWindowFor("claude-fable-5")).toBe(1_000_000);
  });

  it("honors the [1m] beta suffix over the family default", () => {
    expect(contextWindowFor("claude-sonnet-4-6[1m]")).toBe(1_000_000);
  });

  it("gives Opus 4.5+ a native 1M window", () => {
    expect(contextWindowFor("claude-opus-4-5")).toBe(1_000_000);
    expect(contextWindowFor("claude-opus-4-8")).toBe(1_000_000);
    expect(contextWindowFor("claude-opus-5")).toBe(1_000_000);
  });

  it("gives Sonnet 5+ a native 1M window", () => {
    expect(contextWindowFor("claude-sonnet-5")).toBe(1_000_000);
  });

  it("keeps 200k for older versions and Haiku, ignoring date suffixes", () => {
    expect(contextWindowFor("claude-opus-4-1-20250805")).toBe(200_000);
    expect(contextWindowFor("claude-sonnet-4-6")).toBe(200_000);
    expect(contextWindowFor("claude-haiku-4-5-20251001")).toBe(200_000);
  });

  it("falls back to CONTEXT_WINDOW for null, empty, and pseudo-models", () => {
    expect(contextWindowFor(null)).toBe(200_000);
    expect(contextWindowFor(undefined)).toBe(200_000);
    expect(contextWindowFor("")).toBe(200_000);
    expect(contextWindowFor("<synthetic>")).toBe(200_000);
  });
});

describe("estimateCostByComponent", () => {
  const mixed = { input: 2_000_000, output: 1_000_000, cacheRead: 5_000_000, cacheCreate: 1_000_000 };

  it("splits cost so the four components sum to estimateCost", () => {
    for (const model of ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5", "claude-fable-5"]) {
      const c = estimateCostByComponent(model, mixed);
      expect(c.input + c.output + c.cacheRead + c.cacheCreate).toBeCloseTo(estimateCost(model, mixed), 9);
    }
  });

  it("ventilates each component at its own per-model rate", () => {
    // Sonnet: input 3, output 15, cacheRead 0.3, cacheCreate 3.75 per Mtok.
    const c = estimateCostByComponent("claude-sonnet-4-6", mixed);
    expect(c.input).toBeCloseTo(6, 6);        // 2M × $3
    expect(c.output).toBeCloseTo(15, 6);      // 1M × $15
    expect(c.cacheRead).toBeCloseTo(1.5, 6);  // 5M × $0.3
    expect(c.cacheCreate).toBeCloseTo(3.75, 6); // 1M × $3.75
  });

  it("prices cacheRead far below input for the same volume", () => {
    const c = estimateCostByComponent("claude-opus-4-8", { input: 1_000_000, output: 0, cacheRead: 1_000_000, cacheCreate: 0 });
    expect(c.cacheRead).toBeLessThan(c.input);
  });
});
