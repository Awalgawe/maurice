import AnsiToHtml from "ansi-to-html";

const ansiConverter = new AnsiToHtml({ escapeXML: true });

// Same tool_result/stdout strings are converted repeatedly across re-renders;
// cache the result so the ANSI parse only runs once per distinct string.
// Module-level (a singleton) so the cache is shared across every message.
const ansiCache = new Map<string, string>();
const ANSI_CACHE_MAX = 500;

// The result flows into dangerouslySetInnerHTML; never emit unescaped input.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function ansiToHtml(s: string): string {
  const cached = ansiCache.get(s);
  if (cached !== undefined) return cached;
  let out: string;
  try {
    out = ansiConverter.toHtml(s);
  } catch {
    out = escapeHtml(s);
  }
  ansiCache.set(s, out);
  if (ansiCache.size > ANSI_CACHE_MAX) {
    ansiCache.delete(ansiCache.keys().next().value as string);
  }
  return out;
}
