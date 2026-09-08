import type {
  PeerEdge,
  PeerEvent,
  PeerGraph,
  PeerInboundEvent,
  PeerLiveStatus,
  PeerMessageLocation,
  PeerOutboundEvent,
  PeerRef,
  PeerRegistrySnapshot,
  PeerTargetHint,
  SessionMeta,
  UnresolvedPeerEvent,
  UnresolvedReason,
} from "../src/types.ts";

/**
 * Join the per-session peer events of the whole index into cross-session
 * exchanges.
 *
 * Derived, never persisted — like `computeFacets`, it is recomputed from the
 * index on every request. That is what lets it use the live session registry
 * (which changes without any transcript changing) without ever poisoning a
 * cache keyed on (size, mtime).
 *
 * The governing rule is decision 8 of the plan: **a false link is worse than an
 * unresolved exchange.** Every ambiguity ends as `unresolved`, never as a
 * guessed edge.
 */

/** Fallback window for the legacy body-hash join. Observed retransmissions sit
 *  17–19 s apart; 120 s is generous while still bounded. */
const HASH_WINDOW_MS = 120_000;

/** Registry `status` values seen in the wild, plus `waiting` from ListAgents.
 *  Anything else — including a value a future version invents — normalizes to
 *  `unknown`, so the UI can only ever build a key that exists. */
export function normalizeLiveStatus(raw: string | null | undefined): PeerLiveStatus {
  switch (raw) {
    case "idle":
    case "busy":
    case "waiting":
      return raw;
    default:
      return "unknown";
  }
}

interface Owned {
  ev: PeerEvent;
  sessionId: string;
  projectId: string;
  /** targetHint after the global refinement (outbound only). */
  hint: PeerTargetHint;
  consumed: boolean;
  /** Reserved by an over-cardinality msg_id group: unresolved as `ambiguous`,
   *  never as `no_counterpart`. */
  ambiguous: boolean;
}

function location(o: Owned): PeerMessageLocation {
  const ev = o.ev;
  return {
    sessionId: o.sessionId,
    projectId: o.projectId,
    eventId: ev.eventId,
    uuid: ev.uuid,
    toolUseId: ev.direction === "out" ? ev.toolUseId : null,
    index: ev.index,
    branch: ev.fork,
    timestamp: ev.timestamp,
  };
}

/** Refine an `unknown` target with the registry — and only downward, never into
 *  a peer we merely guessed at. A name shared by two live sessions stays
 *  unknown: the registry names, it never identifies. */
function refineHint(ev: PeerOutboundEvent, registry: PeerRegistrySnapshot): PeerTargetHint {
  if (ev.targetHint !== "unknown") return ev.targetHint;
  const target = (ev.rawTarget ?? "").trim();
  if (target && registry.knownAgentTypes.includes(target)) return "in_process";
  const hint = ev.peerNameHint;
  if (hint) {
    const pids = registry.byName[hint];
    if (pids && pids.length === 1) return "peer";
  }
  return "unknown";
}

/** The live session the registry says a send was aimed at, or null when the
 *  answer is not unique. Used for labels and for `peer_not_indexed` — never to
 *  draw an edge. */
function registrySessionFor(
  ev: PeerOutboundEvent,
  registry: PeerRegistrySnapshot,
): { sessionId: string; name: string; status: string | null } | null {
  const target = (ev.rawTarget ?? "").trim();
  const bySocket = registry.bySocket[target];
  if (bySocket !== undefined) return registry.byPid[bySocket] ?? null;
  const hint = ev.peerNameHint;
  if (!hint) return null;
  const pids = registry.byName[hint];
  if (!pids || pids.length !== 1) return null;
  return registry.byPid[pids[0]] ?? null;
}

function sessionLabel(meta: SessionMeta | undefined, registryName: string | null): string {
  if (registryName) return registryName;
  if (!meta) return "?";
  return meta.agentName || meta.aiTitle || meta.projectLabel || meta.id.slice(0, 8);
}

export function computePeerGraph(index: SessionMeta[], registry: PeerRegistrySnapshot): PeerGraph {
  const metaById = new Map<string, SessionMeta>(index.map((m) => [m.id, m]));
  // Live status is per live session; a session id can appear at most once in
  // the registry snapshot, so a flat map is enough.
  const liveBySessionId = new Map<string, string | null>();
  const registryNameBySessionId = new Map<string, string>();
  for (const e of Object.values(registry.byPid)) {
    liveBySessionId.set(e.sessionId, e.status);
    if (e.name) registryNameBySessionId.set(e.sessionId, e.name);
  }

  // A send aimed at an in-process subagent is not a cross-session exchange at
  // all, so it is dropped BEFORE the joins, not after: left in, its body hash
  // (or msg_id) could be picked up by an unrelated receive and become an edge
  // whose source never left this session — a false link, and one that also hid
  // itself from the excludedInProcess count by being consumed.
  const owned: Owned[] = [];
  let excludedInProcess = 0;
  for (const meta of index) {
    for (const ev of meta.peerEvents ?? []) {
      const hint = ev.direction === "out" ? refineHint(ev, registry) : "peer";
      if (ev.direction === "out" && hint === "in_process") {
        excludedInProcess++;
        continue;
      }
      owned.push({
        ev,
        sessionId: meta.id,
        projectId: meta.projectId,
        hint,
        consumed: false,
        ambiguous: false,
      });
    }
  }

  const edges: PeerEdge[] = [];
  const edgeKeys = new Set<string>();

  function addEdge(from: Owned, to: Owned, resolution: "msg_id" | "body_hash", msgId: string | null): void {
    if (from.sessionId === to.sessionId) return; // never a self-edge
    const fromLoc = location(from);
    const toLoc = location(to);
    const key = msgId ?? `${fromLoc.eventId}->${toLoc.eventId}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({
      key,
      msgId,
      from: fromLoc,
      to: toLoc,
      summary: from.ev.direction === "out" ? from.ev.summary : null,
      resolution,
    });
    from.consumed = true;
    to.consumed = true;
  }

  // --- Pass 1: msg_id, the authoritative structured key ---------------------
  const byMsgId = new Map<string, Owned[]>();
  for (const o of owned) {
    const id = o.ev.msgId;
    if (!id) continue;
    if (o.ev.direction === "out" && o.ev.outcome !== "sent") continue;
    (byMsgId.get(id) ?? byMsgId.set(id, []).get(id)!).push(o);
  }
  for (const [msgId, group] of byMsgId) {
    const sends = group.filter((o) => o.ev.direction === "out");
    const receives = group.filter((o) => o.ev.direction === "in");
    if (sends.length === 1 && receives.length === 1 && sends[0].sessionId !== receives[0].sessionId) {
      addEdge(sends[0], receives[0], "msg_id", msgId);
      continue;
    }
    // Reserve the whole group rather than pick a pair whenever the msg_id is
    // shared by more than one event per direction, or names both ends of a
    // single session. A group of one is NOT ambiguous — it is simply a send or
    // a receive whose counterpart is not in the index, and pass 3/4 says so.
    const overCardinality = sends.length > 1 || receives.length > 1;
    if (overCardinality || (sends.length === 1 && receives.length === 1)) {
      for (const o of group) o.ambiguous = true;
    }
  }

  // --- Pass 2: body hash, legacy inbound only -------------------------------
  // Strictly reserved to received turns carrying NO msg_id. An inbound that has
  // a msg_id and did not match in pass 1 must never be rescued by body identity
  // — that would let a weaker key override the authoritative one.
  const byHash = new Map<string, Owned[]>();
  for (const o of owned) {
    if (o.ev.direction !== "out" || o.ev.outcome !== "sent") continue;
    const h = o.ev.bodyHash;
    if (!h) continue;
    (byHash.get(h) ?? byHash.set(h, []).get(h)!).push(o);
  }
  // Candidates are collected for every legacy inbound BEFORE any edge is added,
  // then matched only on mutual uniqueness. Guarding the send side alone would
  // leave two receives competing for one send to be settled by enumeration
  // order — the first inbound consuming the send, the second reported as having
  // no counterpart. That is a guessed edge, which this graph never makes.
  const hashCandidates = new Map<Owned, Owned[]>();
  for (const o of owned) {
    if (o.consumed || o.ambiguous) continue;
    if (o.ev.direction !== "in") continue;
    const inbound = o.ev as PeerInboundEvent;
    if (inbound.msgId !== null) continue;
    if (!inbound.bodyHash) continue;
    const inTs = inbound.timestamp ? Date.parse(inbound.timestamp) : NaN;
    if (!Number.isFinite(inTs)) continue;
    const candidates = (byHash.get(inbound.bodyHash) ?? []).filter((c) => {
      if (c.consumed || c.ambiguous) return false;
      if (c.sessionId === o.sessionId) return false;
      const outTs = c.ev.timestamp ? Date.parse(c.ev.timestamp) : NaN;
      if (!Number.isFinite(outTs)) return false;
      return outTs <= inTs && inTs - outTs <= HASH_WINDOW_MS;
    });
    if (candidates.length > 0) hashCandidates.set(o, candidates);
  }
  const claimants = new Map<Owned, Owned[]>(); // send → inbounds that reached it
  for (const [inbound, candidates] of hashCandidates) {
    for (const send of candidates) (claimants.get(send) ?? claimants.set(send, []).get(send)!).push(inbound);
  }
  for (const [inbound, candidates] of hashCandidates) {
    const only = candidates.length === 1 ? candidates[0] : null;
    if (only && claimants.get(only)!.length === 1) {
      addEdge(only, inbound, "body_hash", null);
      continue;
    }
    // Both ends of an unsettled competition are reserved: neither may fall
    // through to pass 3 and be reported as simply having no counterpart.
    inbound.ambiguous = true;
    for (const send of candidates) send.ambiguous = true;
  }

  // --- Passes 3 & 4: everything left is classified, exactly once ------------
  const unresolved: UnresolvedPeerEvent[] = [];

  function push(o: Owned, reason: UnresolvedReason): void {
    unresolved.push({
      at: location(o),
      direction: o.ev.direction,
      reason,
      peerNameHint: o.ev.peerNameHint,
      outcome: o.ev.direction === "out" ? o.ev.outcome : null,
    });
  }

  for (const o of owned) {
    if (o.consumed) continue;
    if (o.ev.direction === "out") {
      if (o.ambiguous) {
        push(o, "ambiguous");
        continue;
      }
      if (o.ev.outcome !== "sent") {
        push(o, o.hint === "peer" ? "send_failed" : "target_unknown");
        continue;
      }
      if (o.hint !== "peer") {
        push(o, "target_unknown");
        continue;
      }
      const target = registrySessionFor(o.ev, registry);
      push(o, target && !metaById.has(target.sessionId) ? "peer_not_indexed" : "no_counterpart");
    } else {
      push(o, o.ambiguous ? "ambiguous" : "no_counterpart");
    }
  }

  // --- Per-session rollup ---------------------------------------------------
  const bySession: PeerGraph["bySession"] = {};
  function bucket(sessionId: string) {
    return (bySession[sessionId] ??= { peers: [], unresolvedCount: 0 });
  }
  const peerAcc = new Map<string, Map<string, PeerRef>>(); // sessionId → peerSessionId → ref

  function note(selfId: string, other: PeerMessageLocation, direction: "sent" | "received"): void {
    const perSelf = peerAcc.get(selfId) ?? peerAcc.set(selfId, new Map()).get(selfId)!;
    const meta = metaById.get(other.sessionId);
    let ref = perSelf.get(other.sessionId);
    if (!ref) {
      ref = {
        sessionId: other.sessionId,
        projectId: other.projectId,
        label: sessionLabel(meta, registryNameBySessionId.get(other.sessionId) ?? null),
        sent: 0,
        received: 0,
        firstTs: null,
        lastTs: null,
        liveStatus: normalizeLiveStatus(liveBySessionId.get(other.sessionId)),
      };
      perSelf.set(other.sessionId, ref);
    }
    ref[direction]++;
    const ts = other.timestamp;
    if (ts) {
      if (!ref.firstTs || ts < ref.firstTs) ref.firstTs = ts;
      if (!ref.lastTs || ts > ref.lastTs) ref.lastTs = ts;
    }
  }

  for (const e of edges) {
    bucket(e.from.sessionId);
    bucket(e.to.sessionId);
    note(e.from.sessionId, e.to, "sent");
    note(e.to.sessionId, e.from, "received");
  }
  for (const u of unresolved) bucket(u.at.sessionId).unresolvedCount++;
  for (const [sessionId, refs] of peerAcc) {
    bucket(sessionId).peers = [...refs.values()].sort((a, b) => (a.label < b.label ? -1 : 1));
  }

  return { edges, unresolved, excludedInProcess, bySession };
}
