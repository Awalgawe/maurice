import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// CLAUDE_DIR is read at import time by claudeDir.ts — set it before loading
// sessions.ts so readDetail resolves session files inside the temp fixture.
const claudeDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-detail-"));
process.env.CLAUDE_DIR = claudeDir;
const { readDetail, buildMeta } = await import("./sessions.ts");
const { sessionFilePath } = await import("../claudeDir.ts");

const PROJECT = "-tmp-proj";
const SESSION = "s-forked";

const human = (uuid: string, parent: string | null, text: string, ts: string) => ({
  uuid,
  parentUuid: parent,
  type: "user",
  timestamp: ts,
  cwd: "/tmp/proj",
  message: { role: "user", content: text },
});

const assistant = (uuid: string, parent: string | null, requestId: string, ts: string) => ({
  uuid,
  parentUuid: parent,
  type: "assistant",
  timestamp: ts,
  requestId,
  message: {
    id: `msg_${requestId}`,
    role: "assistant",
    model: "claude-sonnet-4-6",
    content: [{ type: "text", text: `answer ${uuid}` }],
    usage: { input_tokens: 10, output_tokens: 5 },
  },
});

// A rewind: "old prompt" branch abandoned, "new prompt" is the live thread.
const lines = [
  human("u1", null, "start", "2026-01-01T10:00:00Z"),
  assistant("a1", "u1", "r1", "2026-01-01T10:00:05Z"),
  human("u2a", "a1", "old prompt", "2026-01-01T10:01:00Z"),
  assistant("a2a", "u2a", "r2", "2026-01-01T10:01:05Z"),
  human("u2b", "a1", "new prompt", "2026-01-01T10:02:00Z"),
  assistant("a2b", "u2b", "r3", "2026-01-01T10:02:05Z"),
];

const fp = sessionFilePath(PROJECT, SESSION);
fs.mkdirSync(path.dirname(fp), { recursive: true });
fs.writeFileSync(fp, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
const stat = fs.statSync(fp);
const meta = await buildMeta({ id: SESSION, projectId: PROJECT, filePath: fp, size: stat.size, mtimeMs: stat.mtimeMs });

afterAll(() => fs.rmSync(claudeDir, { recursive: true, force: true }));

describe("readDetail fork views", () => {
  it("serves only the live thread by default and lists forks", async () => {
    const d = await readDetail(meta, 0, 100);
    expect(d).not.toBeNull();
    expect(d!.branch).toBeNull();
    expect(d!.messages.map((m) => m.uuid)).toEqual(["u1", "a1", "u2b", "a2b"]);
    expect(d!.total).toBe(4);
    expect(d!.forks).toHaveLength(1);
    expect(d!.forks[0]).toMatchObject({
      ref: "f1",
      forkPointUuid: "a1",
      messageCount: 2,
      forkPointIndex: 1,
      forkPointIndexLive: 1,
    });
    expect(d!.forks[0].preview).toContain("old prompt");
  });

  it("marks the fork point with forksHere on the live view", async () => {
    const d = await readDetail(meta, 0, 100);
    const a1 = d!.messages.find((m) => m.uuid === "a1")!;
    expect(a1.forksHere).toEqual(["f1"]);
    expect(a1.fork).toBeNull();
  });

  it("serves a fork view as shared prefix + abandoned subtree", async () => {
    const d = await readDetail(meta, 0, 100, "f1");
    expect(d).not.toBeNull();
    expect(d!.branch).toBe("f1");
    expect(d!.messages.map((m) => m.uuid)).toEqual(["u1", "a1", "u2a", "a2a"]);
    expect(d!.total).toBe(4);
    const u2a = d!.messages.find((m) => m.uuid === "u2a")!;
    expect(u2a.fork).toBe("f1");
    const u1 = d!.messages.find((m) => m.uuid === "u1")!;
    expect(u1.fork).toBeNull(); // prefix stays visually "live"
  });

  it("paginates within the served view", async () => {
    const d = await readDetail(meta, 2, 2, "f1");
    expect(d!.messages.map((m) => m.uuid)).toEqual(["u2a", "a2a"]);
    expect(d!.total).toBe(4);
  });

  it("returns null for an unknown branch ref", async () => {
    expect(await readDetail(meta, 0, 100, "f9")).toBeNull();
  });
});
