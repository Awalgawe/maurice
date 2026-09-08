import { describe, expect, it } from "vitest";
import { computePeerGraph, normalizeLiveStatus } from "./peers.ts";
import type {
  PeerEvent,
  PeerGraph,
  PeerInboundEvent,
  PeerOutboundEvent,
  PeerRegistrySnapshot,
  SessionMeta,
} from "../src/types.ts";

const EMPTY_REGISTRY: PeerRegistrySnapshot = { byPid: {}, bySocket: {}, byName: {}, knownAgentTypes: [] };

function registry(
  entries: { pid: number; sessionId: string; name: string; socket?: string; status?: string | null }[],
  knownAgentTypes: string[] = [],
): PeerRegistrySnapshot {
  const snap: PeerRegistrySnapshot = { byPid: {}, bySocket: {}, byName: {}, knownAgentTypes };
  for (const e of entries) {
    snap.byPid[e.pid] = {
      sessionId: e.sessionId,
      name: e.name,
      cwd: "/tmp",
      socket: e.socket ?? `/tmp/cc-socks/${e.pid}.sock`,
      status: e.status ?? null,
    };
    snap.bySocket[`uds:${e.socket ?? `/tmp/cc-socks/${e.pid}.sock`}`] = e.pid;
    (snap.byName[e.name] ??= []).push(e.pid);
  }
  return snap;
}

let seq = 0;
function out(over: Partial<PeerOutboundEvent> = {}): PeerOutboundEvent {
  seq++;
  return {
    eventId: `e${seq}`,
    uuid: `u${seq}`,
    lineOrdinal: seq,
    index: seq,
    fork: null,
    timestamp: "2026-08-27T10:00:00.000Z",
    bodyHash: null,
    direction: "out",
    msgId: null,
    toolUseId: `t${seq}`,
    blockOrdinal: 0,
    rawTarget: "peer [aa11]",
    peerNameHint: "peer",
    summary: "sum",
    outcome: "sent",
    targetHint: "peer",
    ...over,
  };
}

function inb(over: Partial<PeerInboundEvent> = {}): PeerInboundEvent {
  seq++;
  return {
    eventId: `e${seq}`,
    uuid: `u${seq}`,
    lineOrdinal: seq,
    index: seq,
    fork: null,
    timestamp: "2026-08-27T10:00:01.000Z",
    bodyHash: null,
    direction: "in",
    msgId: null,
    rawFrom: "uds:/tmp/cc-socks/1.sock",
    peerNameHint: "peer",
    parseComplete: true,
    ...over,
  };
}

function session(id: string, peerEvents: PeerEvent[]): SessionMeta {
  return {
    id,
    projectId: `-p-${id}`,
    projectPath: `/p/${id}`,
    projectLabel: id,
    peerEvents,
  } as unknown as SessionMeta;
}

/** Decision 7: every local event lands in exactly one bucket. */
function assertPartition(graph: PeerGraph, index: SessionMeta[]): void {
  const total = index.reduce((n, s) => n + (s.peerEvents?.length ?? 0), 0);
  expect(graph.edges.length * 2 + graph.unresolved.length + graph.excludedInProcess).toBe(total);
}

function run(index: SessionMeta[], reg: PeerRegistrySnapshot = EMPTY_REGISTRY): PeerGraph {
  const g = computePeerGraph(index, reg);
  assertPartition(g, index);
  return g;
}

describe("computePeerGraph — msg_id join", () => {
  it("matches one send to one receive across two sessions", () => {
    const index = [session("A", [out({ msgId: "m1" })]), session("B", [inb({ msgId: "m1" })])];
    const g = run(index);
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0].resolution).toBe("msg_id");
    expect(g.edges[0].key).toBe("m1");
    expect(g.edges[0].from.sessionId).toBe("A");
    expect(g.edges[0].to.sessionId).toBe("B");
    expect(g.unresolved).toHaveLength(0);
  });

  it("reserves a duplicated msg_id as ambiguous, never as no_counterpart", () => {
    const index = [
      session("A", [out({ msgId: "m1" }), out({ msgId: "m1" })]),
      session("B", [inb({ msgId: "m1" })]),
    ];
    const g = run(index);
    expect(g.edges).toHaveLength(0);
    expect(g.unresolved.map((u) => u.reason)).toEqual(["ambiguous", "ambiguous", "ambiguous"]);
  });

  it("never draws a self-edge when both ends carry one session's id", () => {
    const index = [session("A", [out({ msgId: "m1" }), inb({ msgId: "m1" })])];
    const g = run(index);
    expect(g.edges).toHaveLength(0);
    expect(g.unresolved.every((u) => u.reason === "ambiguous")).toBe(true);
  });

  it("does not duplicate an edge key", () => {
    const index = [
      session("A", [out({ msgId: "m1" })]),
      session("B", [inb({ msgId: "m1" })]),
      session("C", [out({ msgId: "m2" })]),
      session("D", [inb({ msgId: "m2" })]),
    ];
    const g = run(index);
    expect(new Set(g.edges.map((e) => e.key)).size).toBe(g.edges.length);
  });
});

describe("computePeerGraph — body-hash fallback", () => {
  const H = "h".repeat(64);

  it("matches a legacy receive to the single send with the same body", () => {
    const index = [
      session("A", [out({ bodyHash: H, timestamp: "2026-08-27T10:00:00.000Z" })]),
      session("B", [inb({ bodyHash: H, msgId: null, timestamp: "2026-08-27T10:00:20.000Z" })]),
    ];
    const g = run(index);
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0].resolution).toBe("body_hash");
    expect(g.edges[0].msgId).toBeNull();
  });

  it("draws ONE edge for a retransmission: the failed send is not a candidate", () => {
    const index = [
      session("A", [
        out({ bodyHash: H, outcome: "needs_ref", timestamp: "2026-08-27T10:00:00.000Z" }),
        out({ bodyHash: H, outcome: "sent", timestamp: "2026-08-27T10:00:17.000Z" }),
      ]),
      session("B", [inb({ bodyHash: H, timestamp: "2026-08-27T10:00:18.000Z" })]),
    ];
    const g = run(index);
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0].from.timestamp).toBe("2026-08-27T10:00:17.000Z");
    expect(g.unresolved.map((u) => u.reason)).toEqual(["send_failed"]);
  });

  it("draws nothing when two successful sends share the body in the window", () => {
    const index = [
      session("A", [out({ bodyHash: H }), out({ bodyHash: H })]),
      session("B", [inb({ bodyHash: H, timestamp: "2026-08-27T10:00:30.000Z" })]),
    ];
    const g = run(index);
    expect(g.edges).toHaveLength(0);
    // Both ends of the competition are reserved — the sends are not merely
    // counterpart-less, they are candidates that could not be told apart.
    expect(g.unresolved.map((u) => u.reason)).toEqual(["ambiguous", "ambiguous", "ambiguous"]);
  });

  it("never joins an in-process send, even when a receive shares its body", () => {
    const index = [
      session("A", [
        out({ bodyHash: H, targetHint: "in_process", rawTarget: "a6f4784e943247236", timestamp: "2026-08-27T10:00:00.000Z" }),
      ]),
      session("B", [inb({ bodyHash: H, timestamp: "2026-08-27T10:00:01.000Z" })]),
    ];
    const g = run(index);
    // The send never left session A: it is not a candidate for any join, and it
    // stays counted as excluded instead of hiding in a consumed edge.
    expect(g.edges).toHaveLength(0);
    expect(g.excludedInProcess).toBe(1);
    expect(g.unresolved.map((u) => `${u.at.sessionId}:${u.reason}`)).toEqual(["B:no_counterpart"]);
  });

  it("draws nothing when two receives compete for one send in the window", () => {
    const index = [
      session("A", [out({ bodyHash: H, timestamp: "2026-08-27T10:00:00.000Z" })]),
      session("B", [inb({ bodyHash: H, timestamp: "2026-08-27T10:00:20.000Z" })]),
      session("C", [inb({ bodyHash: H, timestamp: "2026-08-27T10:00:40.000Z" })]),
    ];
    const g = run(index);
    // Enumeration order must not hand the send to whichever receive comes
    // first: B and C are interchangeable here, so no edge may be drawn.
    expect(g.edges).toHaveLength(0);
    expect(g.unresolved.map((u) => u.reason)).toEqual(["ambiguous", "ambiguous", "ambiguous"]);
    expect(g.unresolved.map((u) => u.at.sessionId).sort()).toEqual(["A", "B", "C"]);
  });

  it("never rescues a receive that HAS a msgId through the body hash", () => {
    const index = [
      session("A", [out({ bodyHash: H, msgId: "m-sent" })]),
      // Same body, inside the window, but this receive carries its own msg_id:
      // the authoritative key did not match, so nothing else may match either.
      session("B", [inb({ bodyHash: H, msgId: "m-other", timestamp: "2026-08-27T10:00:30.000Z" })]),
    ];
    const g = run(index);
    expect(g.edges).toHaveLength(0);
    expect(g.unresolved.map((u) => u.reason).sort()).toEqual(["no_counterpart", "no_counterpart"]);
  });

  it("never matches an empty body", () => {
    const index = [session("A", [out({ bodyHash: null })]), session("B", [inb({ bodyHash: null })])];
    const g = run(index);
    expect(g.edges).toHaveLength(0);
  });

  it("never matches outside the 120 s window, nor a receive that precedes the send", () => {
    const late = [
      session("A", [out({ bodyHash: H, timestamp: "2026-08-27T10:00:00.000Z" })]),
      session("B", [inb({ bodyHash: H, timestamp: "2026-08-27T10:05:00.000Z" })]),
    ];
    expect(run(late).edges).toHaveLength(0);
    const early = [
      session("A", [out({ bodyHash: H, timestamp: "2026-08-27T10:00:10.000Z" })]),
      session("B", [inb({ bodyHash: H, timestamp: "2026-08-27T10:00:00.000Z" })]),
    ];
    expect(run(early).edges).toHaveLength(0);
  });
});

describe("computePeerGraph — unresolved classification", () => {
  it("reports a successful send to a peer with no receive as no_counterpart", () => {
    const g = run([session("A", [out({ msgId: "m1" })])]);
    expect(g.unresolved.map((u) => u.reason)).toEqual(["no_counterpart"]);
  });

  it("reports a failed send to a peer as send_failed", () => {
    const g = run([session("A", [out({ outcome: "unreachable", targetHint: "peer" })])]);
    expect(g.unresolved[0].reason).toBe("send_failed");
    expect(g.unresolved[0].outcome).toBe("unreachable");
  });

  it("excludes an in-process target from both edges and unresolved", () => {
    const g = run([session("A", [out({ targetHint: "in_process", rawTarget: "a6f4784e943247236" })])]);
    expect(g.edges).toHaveLength(0);
    expect(g.unresolved).toHaveLength(0);
    expect(g.excludedInProcess).toBe(1);
  });

  it("refines a known agentType to in_process rather than inventing a peer", () => {
    const g = run(
      [session("A", [out({ targetHint: "unknown", rawTarget: "general-purpose", peerNameHint: "general-purpose" })])],
      registry([], ["general-purpose"]),
    );
    expect(g.excludedInProcess).toBe(1);
  });

  it("leaves a target unknown when the registry has two sessions of that name", () => {
    const g = run(
      [session("A", [out({ targetHint: "unknown", rawTarget: "twin", peerNameHint: "twin" })])],
      registry([
        { pid: 1, sessionId: "X", name: "twin" },
        { pid: 2, sessionId: "Y", name: "twin" },
      ]),
    );
    expect(g.unresolved[0].reason).toBe("target_unknown");
  });

  it("resolves a target named by exactly one live session, and says it is not indexed", () => {
    const g = run(
      [session("A", [out({ targetHint: "unknown", rawTarget: "solo", peerNameHint: "solo" })])],
      registry([{ pid: 1, sessionId: "not-in-index", name: "solo" }]),
    );
    expect(g.unresolved[0].reason).toBe("peer_not_indexed");
  });

  it("reports an unmatched receive as no_counterpart", () => {
    const g = run([session("B", [inb({ msgId: "m1" })])]);
    expect(g.unresolved.map((u) => u.reason)).toEqual(["no_counterpart"]);
  });
});

describe("computePeerGraph — enrichment and purity", () => {
  it("names peers and carries their normalized live status", () => {
    const index = [session("A", [out({ msgId: "m1" })]), session("B", [inb({ msgId: "m1" })])];
    const g = run(index, registry([{ pid: 7, sessionId: "B", name: "boapp-5a", status: "busy" }]));
    const [peer] = g.bySession["A"].peers;
    expect(peer.label).toBe("boapp-5a");
    expect(peer.liveStatus).toBe("busy");
    expect(peer.sent).toBe(1);
    expect(peer.received).toBe(0);
    expect(g.bySession["B"].peers[0].received).toBe(1);
  });

  it("falls back to a closed status value the UI can always translate", () => {
    expect(normalizeLiveStatus("thinking-really-hard")).toBe("unknown");
    expect(normalizeLiveStatus(undefined)).toBe("unknown");
    expect(normalizeLiveStatus("idle")).toBe("idle");
    const index = [session("A", [out({ msgId: "m1" })]), session("B", [inb({ msgId: "m1" })])];
    const g = run(index, registry([{ pid: 7, sessionId: "B", name: "n", status: "brand-new-state" }]));
    expect(g.bySession["A"].peers[0].liveStatus).toBe("unknown");
  });

  it("is pure: same index and registry ⇒ same result", () => {
    const index = [session("A", [out({ msgId: "m1" })]), session("B", [inb({ msgId: "m1" })])];
    const reg = registry([{ pid: 7, sessionId: "B", name: "n", status: "idle" }]);
    expect(JSON.stringify(computePeerGraph(index, reg))).toBe(JSON.stringify(computePeerGraph(index, reg)));
  });

  it("reflects a changed registry with no transcript change", () => {
    const index = [session("A", [out({ msgId: "m1" })]), session("B", [inb({ msgId: "m1" })])];
    const before = computePeerGraph(index, registry([{ pid: 7, sessionId: "B", name: "n", status: "idle" }]));
    const after = computePeerGraph(index, registry([{ pid: 7, sessionId: "B", name: "n", status: "busy" }]));
    expect(before.bySession["A"].peers[0].liveStatus).toBe("idle");
    expect(after.bySession["A"].peers[0].liveStatus).toBe("busy");
  });

  it("ignores sessions with no peer events at all", () => {
    const g = run([session("A", []), session("B", [])]);
    expect(g).toEqual({ edges: [], unresolved: [], excludedInProcess: 0, bySession: {} });
  });
});
