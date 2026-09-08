import crypto from "node:crypto";
import type {
  PeerEvent,
  PeerInbound,
  PeerInboundEvent,
  PeerOutboundEvent,
  PeerOutcome,
  PeerTargetHint,
} from "../../src/types.ts";
import { isUserInterruption } from "./sessions.ts";

/**
 * Cross-session (peer) message events, read from a single transcript.
 *
 * Receiving end: the harness writes a `queue-operation` line and THEN an
 * ordinary `user` turn whose content is
 *   `Another Claude session sent a message:\n<cross-session-message …>…</…>`
 * The anchor is always that user turn, never the queue-operation line.
 *
 * Sending end: an assistant `tool_use` block named `SendMessage`, whose
 * `tool_result` arrives in a LATER user turn, correlated only by tool_use id.
 *
 * Everything here is local and syntactic: nothing reads the live session
 * registry (`~/.claude/sessions/`), which is disk state outside the
 * (size, mtime) cache invalidation. Registry-based refinement happens in
 * `server/peers.ts`, on data that is never persisted.
 */

const INBOUND_PREFIX = "Another Claude session sent a message:";
const ENVELOPE_OPEN = "<cross-session-message";
const ENVELOPE_TAG = /<cross-session-message\b([^>]*)>/;
const ENVELOPE_FULL = /<cross-session-message\b([^>]*)>([\s\S]*?)<\/cross-session-message>/;

/** Proof, inside a SendMessage result, that the target was another Claude
 *  session. Both literals are emitted by the harness itself: the first by a
 *  `needs_ref` failure, the second by a successful send to a bare name. */
const PEER_PROOFS = ["— Claude session, on this machine", "another Claude session on this machine"];

/** `X [2ff6c9]` — a peer name qualified by its disambiguating ref. */
const REF_TARGET = /^\S.*\s\[[0-9a-zA-Z]{4,}\]$/;
/** A bare hex id: an in-process subagent, never a peer session. */
const IN_PROCESS_TARGET = /^[0-9a-f]{16,}$/;
/** The `name [ref]` a needs_ref failure proposes, on its own suggestion line. */
const SUGGESTED_REF = /^\s*(\S.*?\s\[[0-9a-zA-Z]{4,}\])\s+—\s+Claude session/m;
const SUGGESTED_REF_FALLBACK = /"to"\s*:\s*"([^"]+\s\[[0-9a-zA-Z]{4,}\])"/;

const SEND_MESSAGE = "SendMessage";

// ---------------------------------------------------------------------------
// Body normalization and hashing
// ---------------------------------------------------------------------------

/** CRLF→LF and edge trim, and NOTHING else: no case folding, no internal
 *  whitespace collapsing, no Unicode normalization. A body hash must only ever
 *  match a body that is genuinely the same text. */
export function normalizeBody(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

/** Entity decoding, applied to an envelope-extracted body only: the envelope
 *  escapes the payload, the sender's `input.message` does not. */
export function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&"); // last: an escaped &amp;lt; must stay &lt;
}

/** null for an empty/blank body — such a body is never a join candidate. */
export function hashBody(text: string | null): string | null {
  if (text === null) return null;
  const norm = normalizeBody(text);
  if (!norm) return null;
  return crypto.createHash("sha256").update(norm, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Inbound: detection and parsing (two separate functions, on purpose)
// ---------------------------------------------------------------------------

function contentString(obj: any): string | null {
  const c = obj?.message?.content;
  return typeof c === "string" ? c : null;
}

/**
 * Provenance only — never the message body, so a malformed envelope can never
 * make this fail. Structured proof (`origin.kind === "peer"`) wins; otherwise
 * BOTH the prefix and the opening tag are required, so a human prompt that
 * merely quotes the prefix stays `human`.
 */
export function isPeerInbound(obj: any): boolean {
  if (obj?.type !== "user") return false;
  if (obj?.origin?.kind === "peer") return true;
  const text = contentString(obj);
  if (text === null) return false;
  return text.startsWith(INBOUND_PREFIX) && text.includes(ENVELOPE_OPEN);
}

function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`${name}="([^"]*)"`).exec(attrs);
  return m ? m[1] : null;
}

/** `uds:/tmp/cc-socks/93692.sock` → 93692. */
function pidFromSocket(from: string | null): number | null {
  if (!from) return null;
  const m = /\/(\d+)\.sock$/.exec(from);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Decode a received turn. NEVER returns null: a truncated envelope yields
 * partial fields and `parseComplete: false`, so a peer turn is never demoted
 * back to `human` by a parsing accident.
 */
export function parsePeerInbound(obj: any): PeerInbound {
  const raw = contentString(obj) ?? "";
  const origin = obj?.origin;
  const structured = origin?.kind === "peer" ? origin : null;

  const tag = ENVELOPE_TAG.exec(raw);
  const attrs = tag ? tag[1] : "";
  const full = ENVELOPE_FULL.exec(raw);

  const rawFrom: string | null = typeof structured?.from === "string" ? structured.from : attr(attrs, "from");
  const nameHint: string | null =
    typeof structured?.name === "string" ? structured.name : attr(attrs, "from-name");
  const fromMode: string | null =
    typeof structured?.fromMode === "string" ? structured.fromMode : attr(attrs, "from-mode");
  const msgId: string | null = typeof structured?.msg_id === "string" ? structured.msg_id : null;
  const pid =
    typeof structured?.verifiedPeerPid === "number" ? structured.verifiedPeerPid : pidFromSocket(rawFrom);

  let body: string | null = null;
  let parseComplete = false;
  if (typeof structured?.body === "string") {
    // The structured field is the sender's `input.message` verbatim — no decoding.
    body = structured.body;
    parseComplete = true;
  } else if (full) {
    body = decodeEntities(full[2]).trim();
    parseComplete = true;
  } else if (tag) {
    // Opening tag present, closing tag missing: keep what follows it rather
    // than dropping the turn, and say the read was partial.
    body = decodeEntities(raw.slice(tag.index + tag[0].length)).trim() || null;
    parseComplete = false;
  }

  return { body, rawEnvelope: raw, rawFrom, peerNameHint: nameHint, peerPid: pid, msgId, fromMode, parseComplete };
}

// ---------------------------------------------------------------------------
// Outbound: target and outcome classification
// ---------------------------------------------------------------------------

/** Syntactic classification of a SendMessage target. `result` is the COMPLETE
 *  tool_result text — the peer proof can sit well past its 200th character. */
export function classifyTarget(rawTarget: string | null, result: string | null): PeerTargetHint {
  const t = (rawTarget ?? "").trim();
  if (t.startsWith("uds:")) return "peer";
  if (REF_TARGET.test(t)) return "peer";
  // The bare-hex target settles it before the result text is read at all: a
  // SendMessage to an in-process subagent returns that subagent's REPLY, so a
  // subagent merely discussing cross-session messaging would otherwise flip its
  // own send to "peer".
  if (IN_PROCESS_TARGET.test(t)) return "in_process";
  if (result && PEER_PROOFS.some((p) => result.includes(p))) return "peer";
  return "unknown";
}

/** `name [ref]` → `name`; anything else is already the best name we have. */
function nameHintFromTarget(rawTarget: string | null): string | null {
  const t = (rawTarget ?? "").trim();
  if (!t) return null;
  if (t.startsWith("uds:")) return null; // a socket names nothing
  if (IN_PROCESS_TARGET.test(t)) return null;
  const m = /^(.*?)\s\[[0-9a-zA-Z]{4,}\]$/.exec(t);
  return (m ? m[1] : t) || null;
}

interface OutcomeRead {
  outcome: PeerOutcome;
  msgId: string | null;
  suggestedRef: string | null;
}

/** Classify a SendMessage tool_result. Only KNOWN shapes are read; anything
 *  else is `failed_unknown` and carries nothing forward. */
export function classifyOutcome(result: string | null, isError: boolean, denied: boolean): OutcomeRead {
  const none: OutcomeRead = { outcome: "failed_unknown", msgId: null, suggestedRef: null };
  if (result === null) return { ...none, outcome: "no_result" };
  if (denied) return { ...none, outcome: "denied" };
  if (result.includes("InputValidationError")) return { ...none, outcome: "invalid_input" };

  let parsed: any = null;
  try {
    parsed = JSON.parse(result.trim());
  } catch {
    /* not the JSON envelope — fall through to the text probes below */
  }
  if (parsed && typeof parsed === "object") {
    if (parsed.success === true) {
      return {
        outcome: "sent",
        msgId: typeof parsed.msg_id === "string" ? parsed.msg_id : null,
        suggestedRef: null,
      };
    }
    if (parsed.success === false) {
      const m: string = typeof parsed.message === "string" ? parsed.message : "";
      if (m.includes("is not an agent in this conversation")) {
        const s = SUGGESTED_REF.exec(m) ?? SUGGESTED_REF_FALLBACK.exec(m);
        return { outcome: "needs_ref", msgId: null, suggestedRef: s ? s[1] : null };
      }
      if (m.includes("is reachable") || m.includes("reachable.")) {
        return { ...none, outcome: "unreachable" };
      }
      if (m.includes("could not be resumed")) return { ...none, outcome: "not_resumable" };
      return none;
    }
  }
  void isError; // shape, not the error flag, decides — kept for future probes
  return none;
}

// ---------------------------------------------------------------------------
// Collector
// ---------------------------------------------------------------------------

/** Transient, memory-only companion of an event. Never persisted: the raw text
 *  of an unrecognized result may echo the input back. */
export interface PeerRuntimeEvent {
  eventId: string;
  resultExcerpt: string | null;
  body: string | null;
}

export interface PeerCollectorResult {
  /** Every local event, in file order. `index`/`fork` still unassigned. */
  events: PeerEvent[];
  runtime: Map<string, PeerRuntimeEvent>;
  /** Received turns, by turn uuid — for annotating ThreadMessages. */
  inboundByUuid: Map<string, PeerInbound & { eventId: string }>;
  /** eventId of a sending block, by `${lineOrdinal}:${blockOrdinal}` — the key
   *  that stays distinguishable when a block carries no id. */
  outboundByLineBlock: Map<string, string>;
}

export interface PeerCollector {
  add(obj: unknown, lineOrdinal: number): void;
  /** The received turn of `uuid`, already decoded by `add` — so the thread
   *  builder renders the same decode the graph was built from, instead of
   *  parsing the envelope a second time. */
  inboundFor(uuid: string): (PeerInbound & { eventId: string }) | undefined;
  finish(): PeerCollectorResult;
}

const RESULT_EXCERPT_LEN = 400;

interface PendingOut {
  ev: PeerOutboundEvent;
  runtime: PeerRuntimeEvent;
  resolved: boolean;
}

function stringifyResultContent(c: any): string {
  const v = c?.content;
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map((x: any) => (typeof x === "string" ? x : (x?.text ?? ""))).join("\n");
  return "";
}

/**
 * Streaming collector: feed every JSONL line with its ordinal, then finish()
 * once at EOF. Sends are matched to their result by tool_use id ONLY — the
 * result is never adjacent, and body identity would mis-attribute the
 * retransmissions that follow a `needs_ref` failure.
 */
export function createPeerCollector(sessionId: string): PeerCollector {
  const events: PeerEvent[] = [];
  const runtime = new Map<string, PeerRuntimeEvent>();
  const inboundByUuid = new Map<string, PeerInbound & { eventId: string }>();
  const outboundByLineBlock = new Map<string, string>();
  const pendingById = new Map<string, PendingOut>();
  // Blocks with no id can never be resolved, but must still be reported.
  const unkeyed: PendingOut[] = [];

  function add(obj: unknown, lineOrdinal: number): void {
    const o = obj as any;
    if (!o || typeof o !== "object") return;

    if (o.type === "user" && isPeerInbound(o)) {
      const parsed = parsePeerInbound(o);
      const uuid: string | null = typeof o.uuid === "string" ? o.uuid : null;
      const eventId = uuid ? `${sessionId}:in:${uuid}` : `${sessionId}:in:${lineOrdinal}`;
      const ev: PeerInboundEvent = {
        eventId,
        uuid,
        lineOrdinal,
        index: 0,
        fork: null,
        timestamp: typeof o.timestamp === "string" ? o.timestamp : null,
        bodyHash: hashBody(parsed.body),
        bodyLength: parsed.body?.length ?? 0,
        direction: "in",
        msgId: parsed.msgId,
        rawFrom: parsed.rawFrom,
        peerNameHint: parsed.peerNameHint,
        peerPid: parsed.peerPid,
        parseComplete: parsed.parseComplete,
      };
      events.push(ev);
      runtime.set(eventId, { eventId, resultExcerpt: null, body: parsed.body });
      if (uuid) inboundByUuid.set(uuid, { ...parsed, eventId });
      // A received turn also carries no tool_result, so nothing else to do.
      return;
    }

    const content = o?.message?.content;
    if (!Array.isArray(content)) return;

    if (o.type === "assistant") {
      let blockOrdinal = -1;
      for (const c of content) {
        if (!c || typeof c !== "object" || c.type !== "tool_use") continue;
        blockOrdinal++;
        if (c.name !== SEND_MESSAGE) continue;
        const input = (c.input ?? {}) as Record<string, unknown>;
        const toolUseId: string | null = typeof c.id === "string" ? c.id : null;
        const eventId = toolUseId
          ? `${sessionId}:out:${toolUseId}`
          : `${sessionId}:out:${lineOrdinal}:${blockOrdinal}`;
        const body = typeof input.message === "string" ? input.message : null;
        const rawTarget = typeof input.to === "string" ? input.to : null;
        const ev: PeerOutboundEvent = {
          eventId,
          uuid: typeof o.uuid === "string" ? o.uuid : null,
          lineOrdinal,
          index: 0,
          fork: null,
          timestamp: typeof o.timestamp === "string" ? o.timestamp : null,
          bodyHash: hashBody(body),
          bodyLength: body?.length ?? 0,
          direction: "out",
          msgId: null,
          toolUseId,
          blockOrdinal,
          rawTarget,
          peerNameHint: nameHintFromTarget(rawTarget),
          summary: typeof input.summary === "string" ? input.summary : null,
          // Provisional until the result lands; a send with no result at all
          // stays `no_result`, which is strictly reserved for that case.
          outcome: "no_result",
          targetHint: classifyTarget(rawTarget, null),
          suggestedRef: null,
        };
        const rt: PeerRuntimeEvent = { eventId, resultExcerpt: null, body };
        events.push(ev);
        runtime.set(eventId, rt);
        outboundByLineBlock.set(`${lineOrdinal}:${blockOrdinal}`, eventId);
        const pending: PendingOut = { ev, runtime: rt, resolved: false };
        if (toolUseId) pendingById.set(toolUseId, pending);
        else unkeyed.push(pending);
      }
      return;
    }

    if (o.type === "user") {
      for (const c of content) {
        if (!c || typeof c !== "object" || c.type !== "tool_result") continue;
        const id = typeof c.tool_use_id === "string" ? c.tool_use_id : null;
        if (!id) continue;
        const pending = pendingById.get(id);
        if (!pending || pending.resolved) continue;
        pending.resolved = true;
        const text = stringifyResultContent(c);
        const denied = o.toolDenialKind != null || o.interruptedMessageId != null || isUserInterruption(c);
        const read = classifyOutcome(text, c.is_error === true, denied);
        pending.ev.outcome = read.outcome;
        pending.ev.msgId = read.msgId;
        pending.ev.suggestedRef = read.suggestedRef;
        // Re-run on the COMPLETE result: the proof of a peer target may sit
        // far past any excerpt boundary.
        pending.ev.targetHint = classifyTarget(pending.ev.rawTarget, text);
        pending.runtime.resultExcerpt = text.slice(0, RESULT_EXCERPT_LEN);
      }
    }
  }

  function finish(): PeerCollectorResult {
    return { events, runtime, inboundByUuid, outboundByLineBlock };
  }

  function inboundFor(uuid: string) {
    return inboundByUuid.get(uuid);
  }

  return { add, inboundFor, finish };
}

/**
 * Fill each event's position within the view that owns it, using the same
 * activeIdx/forkIdx maps the search index and `readDetail` pagination use — so
 * a peer event deep-links to the very page its turn is rendered on.
 */
export function assignPeerPositions(
  events: PeerEvent[],
  forkOf: (uuid: string | null) => string | null,
  activeIdx: Map<string, number>,
  forkIdx: Map<string, number>,
): void {
  for (const ev of events) {
    if (!ev.uuid) continue;
    const fork = forkOf(ev.uuid);
    ev.fork = fork;
    ev.index = (fork === null ? activeIdx.get(ev.uuid) : forkIdx.get(ev.uuid)) ?? 0;
  }
}
