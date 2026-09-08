/**
 * Reader for a `SendMessage` tool_use input.
 *
 * The body has travelled under several key names across harness versions
 * (`message`, `content`, `prompt`, and both `message` + `content` carrying the
 * same text), and calls also carry fields this UI does not render
 * (`notify_when_idle`, `type`, …). A renderer that reads `message` alone drops
 * the body of the other shapes entirely — worse than the generic JSON dump it
 * replaced. So: pick the body from whichever key holds it, and hand back
 * everything not rendered, to be shown verbatim.
 */

export interface SendMessageFields {
  to: string | null;
  summary: string | null;
  body: string | null;
  /** Which key the body came from — null when the call carries no body. */
  bodyKey: "message" | "content" | "prompt" | null;
  /** Fields this component does not render, for a verbatim dump. */
  rest: Record<string, unknown>;
}

const BODY_KEYS = ["message", "content", "prompt"] as const;

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** `v` is the body itself, or the body truncated with an ellipsis. */
function isEchoOf(v: unknown, body: string | null): boolean {
  if (typeof v !== "string" || body === null) return false;
  if (v === body) return true;
  const stem = v.replace(/(…|\.\.\.)$/, "");
  return stem !== v && stem.length > 0 && body.startsWith(stem);
}

export function readSendMessage(input: Record<string, unknown>): SendMessageFields {
  const to = str(input.to);
  const summary = str(input.summary);
  const bodyKey = BODY_KEYS.find((k) => str(input[k]) !== null) ?? null;
  const body = bodyKey ? str(input[bodyKey]) : null;

  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (k === "to" || k === "summary" || k === bodyKey) continue;
    // A duplicate of the body under another name, and the redundant echo of
    // `to`, carry nothing the header does not already show. The harness also
    // logs `content` as a TRUNCATED copy of `message`, so an ellipsised prefix
    // of the body counts as the same duplicate.
    if ((BODY_KEYS as readonly string[]).includes(k) && isEchoOf(v, body)) continue;
    if (k === "recipient" && v === to) continue;
    if (k === "type" && v === "message") continue;
    // An empty body key is the absence of a body, not a field worth dumping.
    if ((BODY_KEYS as readonly string[]).includes(k) && v === "") continue;
    rest[k] = v;
  }
  return { to, summary, body, bodyKey, rest };
}
