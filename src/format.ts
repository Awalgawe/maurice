export function fmtTokens(n: number, locale?: string): string {
  return new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

export function fmtCost(n: number, locale?: string): string {
  const digits = n < 0.01 ? 4 : n < 1 ? 3 : 2;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    // "$"/"$ " instead of "$US" — everything is USD, the long symbol only costs width.
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
}

export function fmtDate(iso: string | null, locale?: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** Relative "time ago" label for a past ISO timestamp ("2h ago", "il y a 3 j"). */
export function fmtAgo(iso: string | null, locale?: string): string {
  if (!iso) return "—";
  const diffMs = Date.now() - new Date(iso).getTime();
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const sec = Math.round(diffMs / 1000);
  const min = Math.round(sec / 60);
  const hr = Math.round(min / 60);
  const day = Math.round(hr / 24);
  if (Math.abs(sec) < 60) return rtf.format(-sec, "second");
  if (Math.abs(min) < 60) return rtf.format(-min, "minute");
  if (Math.abs(hr) < 24) return rtf.format(-hr, "hour");
  if (Math.abs(day) < 30) return rtf.format(-day, "day");
  return fmtDate(iso, locale);
}

/** Format a YYYY-MM-DD date string without a time component (avoids timezone shifts). */
export function fmtDay(ymd: string, locale?: string): string {
  // Parse as local date to avoid the UTC-midnight → local-time shift.
  const [y, m, d] = ymd.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  }).format(new Date(y, m - 1, d));
}

/** Long day label for list separators: "mercredi 11 juin 2026". */
export function fmtDayLong(ymd: string, locale?: string): string {
  // Parse as local date to avoid the UTC-midnight → local-time shift.
  const [y, m, d] = ymd.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(y, m - 1, d));
}

export function totalTokens(t: {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate: number;
}): number {
  return t.input + t.output + t.cacheRead + t.cacheCreate;
}

/** Drop the awa-/wbd- ugliness into readable skill names. */
export function skillLabel(s: string): string {
  return s.replace(/^awa-/, "awa:").replace(/^wbd-/, "wbd:");
}

/** The model accounting for the most cost in a session (fallback: tokens, then first listed). */
export function dominantModel(s: {
  modelCost: Record<string, number>;
  modelTokens: Record<string, number>;
  models: string[];
}): string {
  const pick = (rec: Record<string, number>) => {
    let best = "";
    let bestV = -Infinity;
    for (const [k, v] of Object.entries(rec || {})) if (v > bestV) { bestV = v; best = k; }
    return best;
  };
  return pick(s.modelCost) || pick(s.modelTokens) || s.models[0] || "";
}

/** Map a Claude model ID to a categorical CSS color token (defined per theme in
 *  index.css). Substring match mirrors priceFor() in server/pricing.ts. */
export function colorForModel(model: string): string {
  const m = (model || "").toLowerCase();
  if (m.includes("opus")) return "var(--model-opus)";
  if (m.includes("haiku")) return "var(--model-haiku)";
  if (m.includes("fable")) return "var(--model-fable)";
  if (m.includes("sonnet")) return "var(--model-sonnet)";
  return "var(--model-other)";
}

/** Shorten a Claude model ID to a human-readable label.
 *  e.g. "claude-fable-5" → "Fable 5", "claude-sonnet-4-6" → "Sonnet 4.6",
 *  "claude-haiku-4-5-20251001" → "Haiku 4.5" */
export function modelLabel(s: string): string {
  // Capture name + major[-minor], where minor is 1-2 digits not followed by more digits
  // (distinguishes version suffix "4-6" from date suffix "20251001").
  const m = s.match(/(fable|sonnet|haiku|opus)-(\d+)(?:-(\d{1,2})(?!\d))?/i);
  if (!m) return s;
  const name = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
  return m[3] ? `${name} ${m[2]}.${m[3]}` : `${name} ${m[2]}`;
}
