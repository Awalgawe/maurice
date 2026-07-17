import { describe, it, expect } from "vitest";
import { createCacheRewriteDetector, CACHE_TTL_MS } from "./cacheRewrite.ts";

const usage = (input: number, cacheRead: number, cacheCreate: number) => ({
  input_tokens: input,
  cache_read_input_tokens: cacheRead,
  cache_creation_input_tokens: cacheCreate,
});

const MODEL = "claude-sonnet-4-6"; // write−read delta: (3.75 − 0.3)/MTok

describe("createCacheRewriteDetector", () => {
  it("never flags the first billed request", () => {
    const d = createCacheRewriteDetector();
    expect(d.check(usage(1000, 0, 99_000), MODEL, "2026-01-01T10:00:00Z")).toBeNull();
  });

  it("does not flag a normal turn (previous context read back from cache)", () => {
    const d = createCacheRewriteDetector();
    d.check(usage(1000, 0, 99_000), MODEL, "2026-01-01T10:00:00Z");
    expect(d.check(usage(200, 100_000, 1_500), MODEL, "2026-01-01T10:01:00Z")).toBeNull();
  });

  it("flags a full rewrite after an idle gap as cause=idle and prices the waste", () => {
    const d = createCacheRewriteDetector();
    d.check(usage(1000, 0, 99_000), MODEL, "2026-01-01T10:00:00Z");
    const rw = d.check(usage(500, 0, 100_000), MODEL, "2026-01-01T10:15:00Z");
    expect(rw).not.toBeNull();
    expect(rw!.cause).toBe("idle");
    expect(rw!.gapMs).toBe(15 * 60 * 1000);
    expect(rw!.gapMs!).toBeGreaterThan(CACHE_TTL_MS);
    expect(rw!.rewrittenTokens).toBe(100_000); // capped at the previous context
    expect(rw!.wastedUSD).toBeCloseTo((100_000 * (3.75 - 0.3)) / 1_000_000, 10);
  });

  it("flags a rewrite within the TTL as cause=context-edit", () => {
    const d = createCacheRewriteDetector();
    d.check(usage(1000, 0, 99_000), MODEL, "2026-01-01T10:00:00Z");
    const rw = d.check(usage(500, 0, 100_000), MODEL, "2026-01-01T10:01:00Z");
    expect(rw).not.toBeNull();
    expect(rw!.cause).toBe("context-edit");
  });

  it("ignores a rewrite below the absolute token floor", () => {
    const d = createCacheRewriteDetector();
    d.check(usage(500, 0, 7_500), MODEL, "2026-01-01T10:00:00Z"); // ctx 8k
    expect(d.check(usage(200, 0, 8_500), MODEL, "2026-01-01T10:15:00Z")).toBeNull();
  });

  it("ignores a partial re-creation below the ratio floor (harness context edits)", () => {
    const d = createCacheRewriteDetector();
    d.check(usage(1000, 0, 99_000), MODEL, "2026-01-01T10:00:00Z");
    // 80k of 100k still read from cache → only 20% re-written: routine, not anomalous.
    expect(d.check(usage(200, 80_000, 30_000), MODEL, "2026-01-01T10:06:00Z")).toBeNull();
  });

  it("does not let a usage-less line (synthetic) reset the chain", () => {
    const d = createCacheRewriteDetector();
    d.check(usage(1000, 0, 99_000), MODEL, "2026-01-01T10:00:00Z");
    expect(d.check(undefined, "<synthetic>", "2026-01-01T10:10:00Z")).toBeNull();
    const rw = d.check(usage(500, 0, 100_000), MODEL, "2026-01-01T10:15:00Z");
    expect(rw).not.toBeNull();
    expect(rw!.cause).toBe("idle"); // gap measured from the last BILLED request
  });

  it("reports cause=tools-changed from diagnostics, whatever the gap", () => {
    const d = createCacheRewriteDetector();
    d.check(usage(1000, 0, 99_000), MODEL, "2026-01-01T10:00:00Z");
    const rw = d.check(usage(500, 0, 100_000), MODEL, "2026-01-01T10:15:00Z", {
      type: "tools_changed",
    });
    expect(rw).not.toBeNull();
    expect(rw!.cause).toBe("tools-changed");
  });

  it("keeps the gap heuristic for previous_message_not_found", () => {
    const d = createCacheRewriteDetector();
    d.check(usage(1000, 0, 99_000), MODEL, "2026-01-01T10:00:00Z");
    const rw = d.check(usage(500, 0, 100_000), MODEL, "2026-01-01T10:15:00Z", {
      type: "previous_message_not_found",
    });
    expect(rw!.cause).toBe("idle");
  });

  it("prices the waste at the request's write tier (all-1h: 6 − 0.3)", () => {
    const d = createCacheRewriteDetector();
    d.check(usage(1000, 0, 99_000), MODEL, "2026-01-01T10:00:00Z");
    const u = {
      ...usage(500, 0, 100_000),
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 100_000 },
    };
    const rw = d.check(u, MODEL, "2026-01-01T10:15:00Z");
    expect(rw!.wastedUSD).toBeCloseTo((100_000 * (6 - 0.3)) / 1_000_000, 10);
  });
});
