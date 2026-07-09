import { estimateCacheRewriteWaste } from "../pricing.ts";
import type { CacheRewrite } from "../../src/types.ts";

// Anthropic prompt-cache TTL: a gap beyond it between two billed requests
// guarantees the cache expired, so the rewrite was caused by idleness.
export const CACHE_TTL_MS = 5 * 60 * 1000;

// Noise floor. The harness legitimately re-creates small context slices
// (context edits, trimmed tool results); only flag when a substantial share
// of the previous context is re-written AND the volume is worth surfacing.
const MIN_REWRITTEN_TOKENS = 10_000;
const MIN_REWRITTEN_RATIO = 0.5;

/**
 * Detects prompt-cache rewrites from per-request usage, fed in file order.
 * A rewrite never shows on one request alone: it's a drop of cache reads vs
 * the previous request's context, covered by cache writes instead. Feed only
 * deduplicated requests (one call per requestId) and skip sidechains — they
 * bill on their own cache stream.
 */
export function createCacheRewriteDetector() {
  let prevCtx = 0;
  let prevTs: number | null = null;
  return {
    check(
      usage: any,
      model: string | null | undefined,
      ts: string | null | undefined,
    ): CacheRewrite | null {
      const cacheRead = usage?.cache_read_input_tokens || 0;
      const cacheCreate = usage?.cache_creation_input_tokens || 0;
      const ctx = (usage?.input_tokens || 0) + cacheRead + cacheCreate;
      if (ctx === 0) return null; // synthetic / usage-less line: no state change
      const tsMs = ts ? Date.parse(ts) : NaN;
      const gapMs = prevTs !== null && !Number.isNaN(tsMs) ? tsMs - prevTs : null;
      const lastCtx = prevCtx;
      prevCtx = ctx;
      if (!Number.isNaN(tsMs)) prevTs = tsMs;
      if (lastCtx === 0) return null; // first billed request of the session
      // Tokens the previous request had in context but this one did NOT read
      // back from cache — capped by what was actually written.
      const rewritten = Math.min(cacheCreate, Math.max(0, lastCtx - cacheRead));
      if (rewritten < MIN_REWRITTEN_TOKENS || rewritten < lastCtx * MIN_REWRITTEN_RATIO) {
        return null;
      }
      return {
        cause: gapMs !== null && gapMs > CACHE_TTL_MS ? "idle" : "context-edit",
        rewrittenTokens: rewritten,
        wastedUSD: estimateCacheRewriteWaste(model, rewritten),
        gapMs,
      };
    },
  };
}
