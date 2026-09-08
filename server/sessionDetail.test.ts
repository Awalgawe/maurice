import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// CLAUDE_DIR is read at import time by claudeDir.ts — set it before loading the
// modules under test so they resolve session files inside the temp fixture.
const claudeDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-peers-"));
process.env.CLAUDE_DIR = claudeDir;
const { readSessionDetail } = await import("./sessionDetail.ts");
const { buildMeta } = await import("./parsers/sessions.ts");
const { sessionFilePath } = await import("./claudeDir.ts");
import type { PeerRegistrySnapshot, SessionMeta } from "../src/types.ts";

const REGISTRY: PeerRegistrySnapshot = { byPid: {}, bySocket: {}, byName: {}, knownAgentTypes: [] };

const PROJECT = "-tmp-proj";
const SENDER = "s-sender";
const RECEIVER = "s-receiver";
const MSG_ID = "msg-0001";
const BODY = "Please review the batching change.";

const envelope =
  `Another Claude session sent a message:\n` +
  `<cross-session-message from="uds:/tmp/cc-socks/11.sock" from-name="sender-a1" from-mode="prompting">\n` +
  `${BODY}\n</cross-session-message>`;

function ts(i: number): string {
  return new Date(Date.UTC(2026, 7, 27, 10, 0, i)).toISOString();
}

/** Sender: a human prompt, the SendMessage, then FILLER human turns, and only
 *  then the tool_result — so the result lands outside the first served page. */
const senderLines: Record<string, unknown>[] = [
  { uuid: "s0", parentUuid: null, type: "user", timestamp: ts(0), cwd: "/tmp/proj", message: { role: "user", content: "go" } },
  {
    uuid: "s1",
    parentUuid: "s0",
    type: "assistant",
    timestamp: ts(1),
    requestId: "r1",
    message: {
      id: "msg_r1",
      role: "assistant",
      model: "claude-sonnet-4-6",
      content: [{ type: "tool_use", id: "t1", name: "SendMessage", input: { to: "receiver-b2 [bb22]", summary: "review request", message: BODY } }],
      usage: { input_tokens: 10, output_tokens: 5 },
    },
  },
  ...Array.from({ length: 4 }, (_, i) => ({
    uuid: `f${i}`,
    parentUuid: i === 0 ? "s1" : `f${i - 1}`,
    type: "user" as const,
    timestamp: ts(2 + i),
    message: { role: "user", content: `filler ${i}` },
  })),
  {
    uuid: "s2",
    parentUuid: "f3",
    type: "user",
    timestamp: ts(9),
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "t1",
          content: JSON.stringify({ success: true, message: "“review request” → receiver-b2 [bb22]", msg_id: MSG_ID }),
        },
      ],
    },
  },
];

const receiverLines: Record<string, unknown>[] = [
  { uuid: "r0", parentUuid: null, type: "user", timestamp: ts(0), cwd: "/tmp/proj2", message: { role: "user", content: "ready" } },
  { type: "queue-operation", operation: "enqueue", timestamp: ts(1) },
  {
    uuid: "r1",
    parentUuid: "r0",
    type: "user",
    isMeta: true,
    timestamp: ts(2),
    origin: {
      kind: "peer",
      from: "uds:/tmp/cc-socks/11.sock",
      verifiedPeerPid: 11,
      msg_id: MSG_ID,
      name: "sender-a1",
      fromMode: "prompting",
      body: BODY,
    },
    message: { role: "user", content: envelope },
  },
  // An unmatched send of its own: must surface as unresolved, on THIS session.
  {
    uuid: "r2",
    parentUuid: "r1",
    type: "assistant",
    timestamp: ts(3),
    requestId: "q1",
    message: {
      id: "msg_q1",
      role: "assistant",
      model: "claude-sonnet-4-6",
      content: [{ type: "tool_use", id: "q1", name: "SendMessage", input: { to: "ghost [cc33]", summary: "hi", message: "nobody home" } }],
      usage: { input_tokens: 1, output_tokens: 1 },
    },
  },
  {
    uuid: "r3",
    parentUuid: "r2",
    type: "user",
    timestamp: ts(4),
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "q1", content: JSON.stringify({ success: true, message: "“hi” → ghost", msg_id: "msg-ghost" }) }],
    },
  },
];

function write(id: string, lines: Record<string, unknown>[]): void {
  const fp = sessionFilePath(PROJECT, id);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
}

write(SENDER, senderLines);
write(RECEIVER, receiverLines);

async function metaOf(id: string): Promise<SessionMeta> {
  const fp = sessionFilePath(PROJECT, id);
  const st = fs.statSync(fp);
  return buildMeta({ id, projectId: PROJECT, filePath: fp, size: st.size, mtimeMs: st.mtimeMs });
}

const index: SessionMeta[] = [await metaOf(SENDER), await metaOf(RECEIVER)];
const senderMeta = index[0];
const receiverMeta = index[1];

afterAll(() => fs.rmSync(claudeDir, { recursive: true, force: true }));

describe("readSessionDetail", () => {
  it("links a sending block to its counterpart, never to its own anchor", async () => {
    const d = (await readSessionDetail(index, REGISTRY, senderMeta, 0, 200))!;
    const view = d.peerEventViews[`${SENDER}:out:t1`];
    expect(view.direction).toBe("out");
    expect(view.outcome).toBe("sent");
    expect(view.edge?.msgId).toBe(MSG_ID);
    expect(view.counterpartLink).toBe(`/sessions/${RECEIVER}#msg-r1`);
    expect(view.counterpartLink).not.toContain(SENDER);
  });

  it("links a received turn back to the sending turn", async () => {
    const d = (await readSessionDetail(index, REGISTRY, receiverMeta, 0, 200))!;
    const view = d.peerEventViews[`${RECEIVER}:in:r1`];
    expect(view.direction).toBe("in");
    expect(view.parseComplete).toBe(true);
    expect(view.counterpartLink).toBe(`/sessions/${SENDER}#msg-s1`);
  });

  it("annotates the SendMessage block with the key its renderer needs", async () => {
    const d = (await readSessionDetail(index, REGISTRY, senderMeta, 0, 200))!;
    const block = d.messages
      .flatMap((m) => m.blocks)
      .find((b) => b.kind === "tool_use" && b.name === "SendMessage");
    expect(block).toBeDefined();
    expect((block as { peerEventId?: string }).peerEventId).toBe(`${SENDER}:out:t1`);
    expect(d.peerEventViews[(block as { peerEventId: string }).peerEventId]).toBeDefined();
  });

  it("annotates the received turn with the same key its card reads", async () => {
    const d = (await readSessionDetail(index, REGISTRY, receiverMeta, 0, 200))!;
    const msg = d.messages.find((m) => m.kind === "peer_in")!;
    expect(msg.peerIn?.eventId).toBe(`${RECEIVER}:in:r1`);
    expect(msg.peerIn?.body).toBe(BODY);
    expect(msg.blocks[0]).toEqual({ kind: "text", text: BODY });
  });

  it("keeps the result excerpt available when the tool_result is off the served page", async () => {
    // Page of 2: the tool_result turn (index 6) is far outside it.
    const d = (await readSessionDetail(index, REGISTRY, senderMeta, 0, 2))!;
    expect(d.messages).toHaveLength(2);
    expect(d.messages.some((m) => m.blocks.some((b) => b.kind === "tool_result"))).toBe(false);
    const view = d.peerEventViews[`${SENDER}:out:t1`];
    expect(view.outcome).toBe("sent");
    expect(view.resultExcerpt).toContain(MSG_ID);
  });

  it("confines peerUnresolved to the session being read", async () => {
    const d = (await readSessionDetail(index, REGISTRY, receiverMeta, 0, 200))!;
    expect(d.peerUnresolved).toHaveLength(1);
    expect(d.peerUnresolved[0].at.sessionId).toBe(RECEIVER);
    expect(d.peerUnresolved[0].reason).toBe("no_counterpart");
    // …and the sender's own detail carries none of it.
    const s = (await readSessionDetail(index, REGISTRY, senderMeta, 0, 200))!;
    expect(s.peerUnresolved).toHaveLength(0);
  });

  it("serves the enriched shape even for a session with no peer traffic", async () => {
    const plain = { ...senderMeta, id: SENDER, peerEvents: [] };
    const d = (await readSessionDetail(index, REGISTRY, plain, 0, 200))!;
    expect(d.peers).toEqual([]);
    expect(d.peerEventViews).toEqual({});
    expect(d.peerUnresolved).toEqual([]);
  });

  it("returns null for an unknown branch, like readDetail does", async () => {
    expect(await readSessionDetail(index, REGISTRY, senderMeta, 0, 200, "f99")).toBeNull();
  });
});

describe("one join, one shape", () => {
  // The API and the MCP server must not be able to drift back into two
  // different session-detail shapes: neither may reach for readDetail directly.
  const here = path.dirname(new URL(import.meta.url).pathname);
  for (const rel of ["routes/api.ts", "mcp.ts"]) {
    it(`${rel} serves details through readSessionDetail`, () => {
      const src = fs.readFileSync(path.join(here, rel), "utf8");
      expect(src).toContain("readSessionDetail");
      expect(src).not.toMatch(/\breadDetail\(/);
    });
  }
});
