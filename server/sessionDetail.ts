import { readDetail, readPeerRuntime } from "./parsers/sessions.ts";
import { computeContinuity } from "./continuity.ts";
import { computePeerGraph } from "./peers.ts";
import { DETAIL_PAGE, messageLink } from "../src/lib/messageLink.ts";
import type {
  PeerEdge,
  PeerEventView,
  PeerGraph,
  PeerRegistrySnapshot,
  SessionDetail,
  SessionMeta,
  UnresolvedPeerEvent,
} from "../src/types.ts";

/**
 * The one place a session detail is assembled: local thread (readDetail) plus
 * the cross-session resolution. `routes/api.ts` and the MCP `get_session` tool
 * both go through it, so the API and the MCP server can never drift into two
 * different shapes.
 *
 * The peer join is derived from the whole index on every call — it is never
 * persisted — while the transient result excerpts come from the same in-memory
 * parse `readDetail` used, so nothing re-reads the file.
 */
export async function readSessionDetail(
  index: SessionMeta[],
  registry: PeerRegistrySnapshot,
  meta: SessionMeta,
  offset: number,
  limit: number,
  branch?: string | null,
): Promise<SessionDetail | null> {
  const local = await readDetail(meta, offset, limit, branch);
  if (!local) return null;

  // Cross-file continuation: same lineage-of-transcripts question as the peer
  // join — index-wide, so recomputed here rather than cached.
  const continuity = computeContinuity(index, meta);

  const hasPeerEvents = (meta.peerEvents?.length ?? 0) > 0;
  if (!hasPeerEvents) {
    // Overwhelmingly the common case: no graph to compute, but the served shape
    // is still the enriched one — the fields are empty, never absent.
    return { ...local, continuity, peers: [], peerEventViews: {}, peerUnresolved: [] };
  }

  const graph = computePeerGraph(index, registry);
  const runtime = await readPeerRuntime(meta);
  const own = graph.bySession[meta.id];

  const edgeByEventId = new Map<string, { edge: PeerEdge; side: "from" | "to" }>();
  for (const e of graph.edges) {
    if (e.from.sessionId === meta.id) edgeByEventId.set(e.from.eventId, { edge: e, side: "from" });
    if (e.to.sessionId === meta.id) edgeByEventId.set(e.to.eventId, { edge: e, side: "to" });
  }
  const unresolvedByEventId = new Map<string, UnresolvedPeerEvent>();
  const peerUnresolved: UnresolvedPeerEvent[] = [];
  for (const u of graph.unresolved) {
    if (u.at.sessionId !== meta.id) continue;
    peerUnresolved.push(u);
    unresolvedByEventId.set(u.at.eventId, u);
  }
  const liveByPeerSession = new Map(own?.peers.map((p) => [p.sessionId, p]) ?? []);

  const peerEventViews: Record<string, PeerEventView> = {};
  for (const ev of meta.peerEvents ?? []) {
    const hit = edgeByEventId.get(ev.eventId);
    const unresolved = unresolvedByEventId.get(ev.eventId) ?? null;
    // The counterpart, never this event's own anchor.
    const counterpart = hit ? (hit.side === "from" ? hit.edge.to : hit.edge.from) : null;
    const peerRef = counterpart ? liveByPeerSession.get(counterpart.sessionId) : undefined;
    peerEventViews[ev.eventId] = {
      eventId: ev.eventId,
      direction: ev.direction,
      edge: hit?.edge ?? null,
      unresolved,
      counterpartLink: counterpart ? messageLink(counterpart.sessionId, counterpart) : null,
      peerLabel: peerRef?.label ?? ev.peerNameHint,
      liveStatus: peerRef?.liveStatus ?? "unknown",
      outcome: ev.direction === "out" ? ev.outcome : null,
      summary: ev.direction === "out" ? ev.summary : null,
      resultExcerpt: ev.direction === "out" ? (runtime.get(ev.eventId)?.resultExcerpt ?? null) : null,
      parseComplete: ev.direction === "in" ? ev.parseComplete : null,
    };
  }

  return { ...local, continuity, peers: own?.peers ?? [], peerEventViews, peerUnresolved };
}

export type { PeerGraph };
export { DETAIL_PAGE };
