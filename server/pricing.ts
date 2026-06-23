import type { TokenTotals } from "../src/types.ts";

// ESTIMATION ONLY — Claude Code subscriptions report costUSD: 0, so we derive
// an indicative cost from public per-million-token API prices. Tweak freely.
// Prices in USD per 1,000,000 tokens. cacheRead is ~0.1x input; cacheCreate
// (5m write) is ~1.25x input for the Anthropic API. (A 1h cache write is 2x,
// but the JSONL usage we read doesn't split the two tiers, so we price all
// cache creation at the 5m rate.)
interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate: number;
}

const PRICES: Record<string, ModelPrice> = {
  // Opus 4.5+ — $5/$25 per MTok, no long-context premium on the 1M window.
  opus: { input: 5, output: 25, cacheRead: 0.5, cacheCreate: 6.25 },
  // Sonnet 4.x
  sonnet: { input: 3, output: 15, cacheRead: 0.3, cacheCreate: 3.75 },
  // Haiku 4.x
  haiku: { input: 1, output: 5, cacheRead: 0.1, cacheCreate: 1.25 },
  // Fable 5 — $10/$50 per MTok.
  fable: { input: 10, output: 50, cacheRead: 1.0, cacheCreate: 12.5 },
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

/** Estimate USD cost split per token component for a bundle attributed to a model.
 *  Same shape as TokenTotals, but the values are USD, not token counts. */
export function estimateCostByComponent(
  model: string | null | undefined,
  t: TokenTotals,
): TokenTotals {
  const p = priceFor(model);
  return {
    input: (t.input * p.input) / 1_000_000,
    output: (t.output * p.output) / 1_000_000,
    cacheRead: (t.cacheRead * p.cacheRead) / 1_000_000,
    cacheCreate: (t.cacheCreate * p.cacheCreate) / 1_000_000,
  };
}

/** Estimate total USD cost for a token bundle attributed to a model. */
export function estimateCost(model: string | null | undefined, t: TokenTotals): number {
  const c = estimateCostByComponent(model, t);
  return c.input + c.output + c.cacheRead + c.cacheCreate;
}
