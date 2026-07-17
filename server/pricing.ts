import type { TokenTotals } from "../src/types.ts";
import type { CacheTierSplit } from "./parsers/jsonl.ts";
import { CONTEXT_WINDOW } from "./claudeDir.ts";

// ESTIMATION ONLY — Claude Code subscriptions report costUSD: 0, so we derive
// an indicative cost from public per-million-token API prices. Tweak freely.
// Prices in USD per 1,000,000 tokens. cacheRead is ~0.1x input; cache writes
// are tiered: 5m TTL ≈ 1.25x input, 1h TTL ≈ 2x input. usage.cache_creation
// carries the per-tier token split; logs that predate it are priced at the 5m
// rate (conservative — the tier is genuinely unknown there).
interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate5m: number;
  cacheCreate1h: number;
}

const PRICES: Record<string, ModelPrice> = {
  // Opus 4.5+ — $5/$25 per MTok, no long-context premium on the 1M window.
  opus: { input: 5, output: 25, cacheRead: 0.5, cacheCreate5m: 6.25, cacheCreate1h: 10 },
  // Sonnet 4.x
  sonnet: { input: 3, output: 15, cacheRead: 0.3, cacheCreate5m: 3.75, cacheCreate1h: 6 },
  // Haiku 4.x
  haiku: { input: 1, output: 5, cacheRead: 0.1, cacheCreate5m: 1.25, cacheCreate1h: 2 },
  // Fable 5 — $10/$50 per MTok.
  fable: { input: 10, output: 50, cacheRead: 1.0, cacheCreate5m: 12.5, cacheCreate1h: 20 },
};

// Track which unknown models we've already warned about so the fallback to
// Sonnet pricing is surfaced once, not silently, per process.
const warnedUnknown = new Set<string>();

function priceFor(model: string | null | undefined): ModelPrice {
  const m = (model || "").toLowerCase();
  if (m.includes("opus")) return PRICES.opus;
  if (m.includes("haiku")) return PRICES.haiku;
  if (m.includes("fable")) return PRICES.fable;
  if (m.includes("sonnet")) return PRICES.sonnet;
  if (m && !warnedUnknown.has(m)) {
    warnedUnknown.add(m);
    console.warn(`[pricing] unknown model "${model}" — falling back to Sonnet pricing`);
  }
  return PRICES.sonnet; // default / unknown
}

/** Context window (tokens) for a model id. A "[1m]" suffix on the id means the
 *  1M-context beta is enabled, regardless of family. Fable, Opus 4.5+ and
 *  Sonnet 5+ ship a native 1M window without the suffix (observed >200k
 *  contexts in real logs for all three). */
export function contextWindowFor(model: string | null | undefined): number {
  const m = (model || "").toLowerCase();
  if (m.includes("[1m]")) return 1_000_000;
  if (m.includes("fable")) return 1_000_000;
  // "claude-opus-4-8" → [4, 8]; date suffixes ("-20251001") only ever follow
  // the version, so the first two numeric segments are the version.
  const version = (family: string): [number, number] | null => {
    const match = m.match(new RegExp(`${family}-(\\d+)(?:-(\\d+))?`));
    return match ? [Number(match[1]), Number(match[2] || 0)] : null;
  };
  const opus = version("opus");
  if (opus && (opus[0] > 4 || (opus[0] === 4 && opus[1] >= 5))) return 1_000_000;
  const sonnet = version("sonnet");
  if (sonnet && sonnet[0] >= 5) return 1_000_000;
  return CONTEXT_WINDOW; // env fallback (default 200k) — also null / pseudo-models
}

/** USD for `t.cacheCreate` write tokens, tier-priced when the split is known.
 *  Tokens beyond the split's sum (or all of them when split is null) get the
 *  5m rate — the tier is unknown for them. */
function cacheCreateUSD(p: ModelPrice, t: TokenTotals, split: CacheTierSplit | null): number {
  if (!split) return (t.cacheCreate * p.cacheCreate5m) / 1_000_000;
  const rest = Math.max(0, t.cacheCreate - split.m5 - split.h1);
  return (
    (split.m5 * p.cacheCreate5m + split.h1 * p.cacheCreate1h + rest * p.cacheCreate5m) / 1_000_000
  );
}

/** Estimate USD cost split per token component for a bundle attributed to a model.
 *  Same shape as TokenTotals, but the values are USD, not token counts. */
export function estimateCostByComponent(
  model: string | null | undefined,
  t: TokenTotals,
  split: CacheTierSplit | null = null,
): TokenTotals {
  const p = priceFor(model);
  return {
    input: (t.input * p.input) / 1_000_000,
    output: (t.output * p.output) / 1_000_000,
    cacheRead: (t.cacheRead * p.cacheRead) / 1_000_000,
    cacheCreate: cacheCreateUSD(p, t, split),
  };
}

/** Estimated avoidable USD surcost of re-writing `tokens` cache tokens that a
 *  warm cache would have served as reads (cache-write − cache-read rate). The
 *  write rate is the request's tier mix when known, else the 5m rate. */
export function estimateCacheRewriteWaste(
  model: string | null | undefined,
  tokens: number,
  split: CacheTierSplit | null = null,
): number {
  const p = priceFor(model);
  const total = split ? split.m5 + split.h1 : 0;
  const writeRate =
    total > 0 ? (split!.m5 * p.cacheCreate5m + split!.h1 * p.cacheCreate1h) / total : p.cacheCreate5m;
  return (tokens * (writeRate - p.cacheRead)) / 1_000_000;
}

/** Estimate total USD cost for a token bundle attributed to a model. */
export function estimateCost(
  model: string | null | undefined,
  t: TokenTotals,
  split: CacheTierSplit | null = null,
): number {
  const c = estimateCostByComponent(model, t, split);
  return c.input + c.output + c.cacheRead + c.cacheCreate;
}
