import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildMetaAndDocs, classifyMessage } from "./sessions.ts";
import type { SessionFile } from "../claudeDir.ts";
import type { PeerOutboundEvent } from "../../src/types.ts";

/**
 * Attribution side of the peer work (Lot 1): a turn received from another
 * session is neither a human prompt nor indexable text, and its protocol
 * envelope must never leak into firstUserPrompt or the search index.
 */

const ENVELOPE_BODY = "Please review the batching change in query/attribute.ts";
const envelope =
  `Another Claude session sent a message:\n` +
  `<cross-session-message from="uds:/tmp/cc-socks/93692.sock" from-name="boapp-5a" from-mode="prompting">\n` +
  `${ENVELOPE_BODY}\n</cross-session-message>`;

const lines: Record<string, unknown>[] = [
  { type: "queue-operation", operation: "enqueue", timestamp: "2026-08-27T09:59:00Z" },
  // A received turn arrives BEFORE the first real human prompt.
  {
    uuid: "u-peer",
    type: "user",
    isMeta: true,
    timestamp: "2026-08-27T10:00:00Z",
    cwd: "/tmp/proj",
    origin: {
      kind: "peer",
      from: "uds:/tmp/cc-socks/93692.sock",
      verifiedPeerPid: 93692,
      msg_id: "msg-abc",
      name: "boapp-5a",
      fromMode: "prompting",
      body: ENVELOPE_BODY,
    },
    message: { role: "user", content: envelope },
  },
  { uuid: "u-human", type: "user", timestamp: "2026-08-27T10:01:00Z", message: { role: "user", content: "Fix the bug please" } },
  {
    uuid: "a-send",
    type: "assistant",
    timestamp: "2026-08-27T10:02:00Z",
    requestId: "r1",
    message: {
      model: "claude-sonnet-4-6",
      role: "assistant",
      content: [{ type: "tool_use", id: "t1", name: "SendMessage", input: { to: "boapp-5a [aa11]", summary: "verdict", message: "here is my verdict" } }],
    },
  },
  {
    uuid: "u-res",
    type: "user",
    timestamp: "2026-08-27T10:02:05Z",
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "t1",
          content: JSON.stringify({ success: true, message: "“verdict” → boapp-5a [aa11]", msg_id: "msg-def" }),
        },
      ],
    },
  },
];

let dir: string;
let file: SessionFile;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "sess-peers-"));
  const fp = path.join(dir, "s1.jsonl");
  fs.writeFileSync(fp, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  const stat = fs.statSync(fp);
  file = { id: "s1", projectId: "-tmp-proj", filePath: fp, size: stat.size, mtimeMs: stat.mtimeMs };
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("peer attribution in buildMetaAndDocs", () => {
  it("never lets a received turn become the first user prompt", async () => {
    const { meta } = await buildMetaAndDocs(file);
    expect(meta.firstUserPrompt).toBe("Fix the bug please");
  });

  it("indexes the decoded body, never the envelope", async () => {
    const { searchDocs } = await buildMetaAndDocs(file);
    const doc = searchDocs.find((d) => d.uuid === "u-peer");
    expect(doc).toBeDefined();
    expect(doc!.body).toBe(ENVELOPE_BODY);
    expect(searchDocs.some((d) => d.body.includes("<cross-session-message"))).toBe(false);
    expect(searchDocs.some((d) => d.body.includes("Another Claude session sent"))).toBe(false);
  });

  it("records both directions as local peer events", async () => {
    const { meta } = await buildMetaAndDocs(file);
    const evs = meta.peerEvents ?? [];
    expect(evs.map((e) => e.direction)).toEqual(["in", "out"]);
    const inbound = evs[0];
    expect(inbound.eventId).toBe("s1:in:u-peer");
    expect(inbound.uuid).toBe("u-peer");
    const outbound = evs[1] as PeerOutboundEvent;
    expect(outbound.outcome).toBe("sent");
    expect(outbound.msgId).toBe("msg-def");
    expect(outbound.targetHint).toBe("peer");
  });

  it("positions each event within the view that owns it", async () => {
    const { meta } = await buildMetaAndDocs(file);
    const evs = meta.peerEvents ?? [];
    // Renderable turns, in order: u-peer, u-human, a-send, u-res.
    expect(evs[0].index).toBe(0);
    expect(evs[0].fork).toBeNull();
    expect(evs[1].index).toBe(2);
  });
});

describe("classifyMessage", () => {
  it("classifies a received turn as peer_in, ahead of isMeta", () => {
    expect(classifyMessage(lines[1], [{ kind: "text", text: envelope }], new Map())).toBe("peer_in");
  });

  it("still classifies an ordinary meta turn as meta", () => {
    expect(classifyMessage({ type: "user", isMeta: true, message: { content: "ctx" } }, [], new Map())).toBe("meta");
  });
});
