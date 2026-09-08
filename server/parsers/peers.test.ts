import { describe, expect, it } from "vitest";
import {
  classifyOutcome,
  classifyTarget,
  createPeerCollector,
  hashBody,
  isPeerInbound,
  parsePeerInbound,
} from "./peers.ts";
import type { PeerInboundEvent, PeerOutboundEvent } from "../../src/types.ts";

const TS = "2026-08-27T10:00:00.000Z";

function envelope(from: string, name: string, body: string): string {
  return (
    `Another Claude session sent a message:\n` +
    `<cross-session-message from="${from}" from-name="${name}" from-mode="prompting">\n${body}\n</cross-session-message>`
  );
}

/** Modern inbound turn: the harness also stores the structured `origin`. */
function inboundModern(uuid: string, body: string, msgId = "m-1"): Record<string, unknown> {
  return {
    uuid,
    type: "user",
    isMeta: true,
    timestamp: TS,
    origin: {
      kind: "peer",
      from: "uds:/tmp/cc-socks/93692.sock",
      verifiedPeerPid: 93692,
      msg_id: msgId,
      name: "boapp-5a",
      fromMode: "prompting",
      body,
    },
    message: { role: "user", content: envelope("uds:/tmp/cc-socks/93692.sock", "boapp-5a", body) },
  };
}

/** Legacy inbound turn: the body only exists inside the envelope. */
function inboundLegacy(uuid: string, body: string): Record<string, unknown> {
  return {
    uuid,
    type: "user",
    timestamp: TS,
    message: { role: "user", content: envelope("uds:/tmp/cc-socks/42.sock", "peer-x", body) },
  };
}

function send(
  uuid: string,
  toolId: string | null,
  to: string,
  message: string,
  summary = "sum",
): Record<string, unknown> {
  return {
    uuid,
    type: "assistant",
    timestamp: TS,
    message: {
      role: "assistant",
      content: [{ type: "tool_use", ...(toolId ? { id: toolId } : {}), name: "SendMessage", input: { to, summary, message } }],
    },
  };
}

function result(uuid: string, toolId: string, content: string, extra: Record<string, unknown> = {}) {
  return {
    uuid,
    type: "user",
    timestamp: TS,
    ...extra,
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: toolId, content }] },
  };
}

const ok = (target: string, msgId = "m-1") =>
  JSON.stringify({ success: true, message: `“sum” → ${target}`, msg_id: msgId });

const needsRef = (name: string, ref: string) =>
  JSON.stringify({
    success: false,
    message:
      `'${name}' is not an agent in this conversation. Re-send with the ref to confirm you mean:\n` +
      `  ${name} [${ref}] — Claude session, on this machine, active 2m ago\n` +
      `e.g. {"to": "${name} [${ref}]", ...}`,
  });

function collect(sessionId: string, objs: Record<string, unknown>[]) {
  const c = createPeerCollector(sessionId);
  objs.forEach((o, i) => c.add(o, i));
  return c.finish();
}

const outs = (r: ReturnType<typeof collect>) => r.events.filter((e) => e.direction === "out") as PeerOutboundEvent[];
const ins = (r: ReturnType<typeof collect>) => r.events.filter((e) => e.direction === "in") as PeerInboundEvent[];

describe("isPeerInbound / parsePeerInbound", () => {
  it("recognizes a modern inbound turn and decodes its body from origin", () => {
    const obj = inboundModern("u1", "hello peer");
    expect(isPeerInbound(obj)).toBe(true);
    const p = parsePeerInbound(obj);
    expect(p.body).toBe("hello peer");
    expect(p.msgId).toBe("m-1");
    expect(p.peerNameHint).toBe("boapp-5a");
    expect(p.parseComplete).toBe(true);
  });

  it("decodes a legacy envelope body identically to the sender's input.message", () => {
    const body = 'a < b && c > d, "quoted" and \'apostrophes\'';
    const escaped = body
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
    const obj = {
      uuid: "u1",
      type: "user",
      timestamp: TS,
      message: { role: "user", content: envelope("uds:/tmp/cc-socks/42.sock", "peer-x", escaped) },
    };
    expect(isPeerInbound(obj)).toBe(true);
    const p = parsePeerInbound(obj);
    expect(p.body).toBe(body);
    expect(p.msgId).toBeNull();
    expect(p.parseComplete).toBe(true);
  });

  it("keeps a truncated envelope as a peer turn, flagged incomplete", () => {
    const obj = {
      uuid: "u1",
      type: "user",
      timestamp: TS,
      message: {
        role: "user",
        content:
          'Another Claude session sent a message:\n<cross-session-message from="uds:/tmp/cc-socks/7.sock" from-name="p">\nhalf a bo',
      },
    };
    expect(isPeerInbound(obj)).toBe(true);
    const p = parsePeerInbound(obj);
    expect(p.parseComplete).toBe(false);
    expect(p.body).toBe("half a bo");
    expect(p.peerNameHint).toBe("p");
  });

  it("leaves a human prompt that merely quotes the prefix alone", () => {
    const obj = {
      uuid: "u1",
      type: "user",
      timestamp: TS,
      message: {
        role: "user",
        content: "Another Claude session sent a message: what does that mean exactly?",
      },
    };
    expect(isPeerInbound(obj)).toBe(false);
  });

  it("does not misread an assistant turn or a tool_result turn as inbound", () => {
    expect(isPeerInbound({ type: "assistant", message: { content: [] } })).toBe(false);
    expect(
      isPeerInbound({ type: "user", message: { content: [{ type: "tool_result", content: "<cross-session-message" }] } }),
    ).toBe(false);
  });
});

describe("classifyTarget", () => {
  it("reads a socket and a ref-qualified name as a peer", () => {
    expect(classifyTarget("uds:/tmp/cc-socks/21426.sock", null)).toBe("peer");
    expect(classifyTarget("custom-mcp-09 [0381d0]", null)).toBe("peer");
  });

  it("reads a bare hex id as an in-process subagent", () => {
    expect(classifyTarget("a6f4784e943247236", null)).toBe("in_process");
  });

  it("keeps a bare hex id in-process even when its reply talks about peers", () => {
    // The result of an in-process send is the subagent's own reply: a subagent
    // discussing cross-session messaging must not reclassify its own send.
    const reply = "I checked: this mentions another Claude session on this machine.";
    expect(classifyTarget("a6f4784e943247236", reply)).toBe("in_process");
  });

  it("leaves a bare name unknown, and an agentType unknown", () => {
    expect(classifyTarget("custom-mcp-09", null)).toBe("unknown");
    expect(classifyTarget("general-purpose", null)).toBe("unknown");
  });

  it("finds the peer proof past the 200th character of the result", () => {
    const padded = `${"x".repeat(400)}\n  custom-mcp-09 [0381d0] — Claude session, on this machine, active 2m ago`;
    expect(classifyTarget("custom-mcp-09", padded)).toBe("peer");
  });
});

describe("classifyOutcome", () => {
  it("tells failed_unknown (a result IS present) from no_result (none at all)", () => {
    expect(classifyOutcome(null, false).outcome).toBe("no_result");
    expect(classifyOutcome("something the harness has never emitted", false).outcome).toBe("failed_unknown");
  });

  it("classifies each observed shape", () => {
    expect(classifyOutcome(ok("peer", "abc"), false)).toEqual({ outcome: "sent", msgId: "abc" });
    expect(classifyOutcome(needsRef("custom-mcp-09", "0381d0"), false)).toEqual({ outcome: "needs_ref", msgId: null });
    expect(
      classifyOutcome(JSON.stringify({ success: false, message: "No agent named 'general-purpose' is reachable." }), false)
        .outcome,
    ).toBe("unreachable");
    expect(
      classifyOutcome(
        JSON.stringify({ success: false, message: 'Agent "a41d" could not be resumed: No transcript found' }),
        false,
      ).outcome,
    ).toBe("not_resumable");
    expect(classifyOutcome("<tool_use_error>InputValidationError: SendMessage failed…", false).outcome).toBe(
      "invalid_input",
    );
    expect(classifyOutcome("The user doesn't want to proceed with this tool use", true).outcome).toBe("denied");
  });
});

describe("createPeerCollector", () => {
  it("resolves a tool_result that lands several lines after the tool_use", () => {
    const r = collect("s1", [
      send("a1", "t1", "peer-x [aa11]", "body"),
      { uuid: "n1", type: "assistant", timestamp: TS, message: { role: "assistant", content: [{ type: "text", text: "…" }] } },
      { uuid: "n2", type: "user", timestamp: TS, message: { role: "user", content: "unrelated" } },
      result("r1", "t1", ok("peer-x [aa11]", "mm")),
    ]);
    const [ev] = outs(r);
    expect(ev.outcome).toBe("sent");
    expect(ev.msgId).toBe("mm");
    expect(ev.eventId).toBe("s1:out:t1");
    expect(r.runtime.get(ev.eventId)?.resultExcerpt).toContain("mm");
  });

  it("gives two identical sends in one turn two distinct event ids", () => {
    const line = {
      uuid: "a1",
      type: "assistant",
      timestamp: TS,
      message: {
        role: "assistant",
        content: [
          { type: "tool_use", id: "t1", name: "SendMessage", input: { to: "p [aa11]", summary: "s", message: "same" } },
          { type: "tool_use", id: "t2", name: "SendMessage", input: { to: "p [aa11]", summary: "s", message: "same" } },
        ],
      },
    };
    const ids = outs(collect("s1", [line])).map((e) => e.eventId);
    expect(ids).toEqual(["s1:out:t1", "s1:out:t2"]);
  });

  it("keeps two id-less SendMessage blocks on one line distinguishable", () => {
    const line = {
      uuid: "a1",
      type: "assistant",
      timestamp: TS,
      message: {
        role: "assistant",
        content: [
          { type: "tool_use", name: "SendMessage", input: { to: "p [aa11]", summary: "s", message: "one" } },
          { type: "tool_use", name: "SendMessage", input: { to: "p [aa11]", summary: "s", message: "two" } },
        ],
      },
    };
    const r = collect("s1", [line]);
    const ev = outs(r);
    expect(ev.map((e) => e.eventId)).toEqual(["s1:out:0:0", "s1:out:0:1"]);
    expect([...r.outboundByLineBlock.keys()]).toEqual(["0:0", "0:1"]);
    // No id ⇒ no tool_result can ever be correlated to them.
    expect(ev.map((e) => e.outcome)).toEqual(["no_result", "no_result"]);
  });

  it("counts the block ordinal over tool_use blocks only, as extractBlocks does", () => {
    const line = {
      uuid: "a1",
      type: "assistant",
      timestamp: TS,
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "thinking out loud" },
          { type: "tool_use", id: "t0", name: "Bash", input: {} },
          { type: "tool_use", name: "SendMessage", input: { to: "p [aa11]", summary: "s", message: "x" } },
        ],
      },
    };
    expect(outs(collect("s1", [line]))[0].eventId).toBe("s1:out:0:1");
  });

  it("keeps an inbound turn without uuid, keyed on its line ordinal", () => {
    const obj = inboundModern("x", "body");
    delete (obj as Record<string, unknown>).uuid;
    const r = collect("s1", [{ type: "system" }, obj]);
    const [ev] = ins(r);
    expect(ev.uuid).toBeNull();
    expect(ev.eventId).toBe("s1:in:1");
    expect(r.inboundByUuid.size).toBe(0);
  });

  it("never gives an empty body a hash", () => {
    const r = collect("s1", [send("a1", "t1", "p [aa11]", "   ")]);
    expect(outs(r)[0].bodyHash).toBeNull();
    expect(hashBody("")).toBeNull();
  });

  it("hashes a legacy inbound body to the same value as the sender's input", () => {
    const body = "review request:\r\n  line two";
    const sent = outs(collect("s1", [send("a1", "t1", "p [aa11]", body)]))[0];
    const received = ins(collect("s2", [inboundLegacy("u1", body)]))[0];
    expect(received.bodyHash).toBe(sent.bodyHash);
    expect(received.bodyHash).not.toBeNull();
  });

  it("carries no field of the opposite direction", () => {
    const r = collect("s1", [send("a1", "t1", "p [aa11]", "x"), inboundModern("u1", "y")]);
    expect(outs(r)[0]).not.toHaveProperty("parseComplete");
    expect(ins(r)[0]).not.toHaveProperty("outcome");
  });

  it("re-reads targetHint on the complete result, not on the input alone", () => {
    const r = collect("s1", [
      send("a1", "t1", "custom-mcp-09", "body"),
      result("r1", "t1", needsRef("custom-mcp-09", "0381d0")),
    ]);
    const [ev] = outs(r);
    expect(ev.targetHint).toBe("peer");
    expect(ev.outcome).toBe("needs_ref");
    expect(ev.peerNameHint).toBe("custom-mcp-09");
  });

  it("marks a user-refused send denied, not failed", () => {
    const r = collect("s1", [
      send("a1", "t1", "p [aa11]", "body"),
      result("r1", "t1", "The user doesn't want to proceed with this tool use", { toolDenialKind: "user-rejected" }),
    ]);
    expect(outs(r)[0].outcome).toBe("denied");
  });

  it("persists no result text on the event itself", () => {
    const echo = "unrecognized shape echoing the body back: secret payload";
    const r = collect("s1", [send("a1", "t1", "p [aa11]", "secret payload"), result("r1", "t1", echo)]);
    const [ev] = outs(r);
    expect(ev.outcome).toBe("failed_unknown");
    expect(JSON.stringify(ev)).not.toContain("secret payload");
    // …the excerpt exists, but only in the in-memory runtime map.
    expect(r.runtime.get(ev.eventId)?.resultExcerpt).toContain("secret payload");
  });

  it("ignores tool_use blocks of other tools", () => {
    const r = collect("s1", [
      { uuid: "a1", type: "assistant", timestamp: TS, message: { role: "assistant", content: [{ type: "tool_use", id: "t9", name: "Bash", input: {} }] } },
    ]);
    expect(r.events).toHaveLength(0);
  });
});
