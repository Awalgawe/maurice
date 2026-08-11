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

const assistant = (
  uuid: string,
  parent: string | null,
  requestId: string,
  ts: string,
  opts: { model?: string; usage?: object; sidechain?: boolean } = {},
) => ({
  uuid,
  parentUuid: parent,
  type: "assistant",
  timestamp: ts,
  requestId,
  ...(opts.sidechain ? { isSidechain: true } : {}),
  message: {
    id: `msg_${requestId}`,
    role: "assistant",
    model: opts.model ?? "claude-sonnet-4-6",
    content: [{ type: "text", text: `answer ${uuid}` }],
    usage: opts.usage ?? { input_tokens: 10, output_tokens: 5 },
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

describe("context curve per-model windows", () => {
  const CTX_SESSION = "s-models";

  const ctxLines = [
    human("u1", null, "start", "2026-01-01T10:00:00Z"),
    // 100k on Sonnet 4.5 (200k window) → 50%
    assistant("a1", "u1", "c1", "2026-01-01T10:00:05Z",
      { model: "claude-sonnet-4-5", usage: { input_tokens: 100_000, output_tokens: 5 } }),
    // Same 100k on Fable (1M window) → 10%: model change vs a1
    assistant("a2", "a1", "c2", "2026-01-01T10:01:05Z",
      { model: "claude-fable-5", usage: { input_tokens: 100_000, output_tokens: 5 } }),
    // Subagent turn: flagged sidechain so the UI skips it for markers
    assistant("a3", "a2", "c3", "2026-01-01T10:02:05Z",
      { model: "claude-fable-5", sidechain: true, usage: { input_tokens: 50_000, output_tokens: 5 } }),
    // 300k on a 200k-window Sonnet with the 1M beta suffix → 30% (old global
    // window clamped this to 100%). The suffix must beat the family default,
    // so this stays on a model whose native window is 200k.
    assistant("a4", "a3", "c4", "2026-01-01T10:03:05Z",
      { model: "claude-sonnet-4-5[1m]", usage: { input_tokens: 300_000, output_tokens: 5 } }),
  ];

  it("computes per-point pct over each turn's model window", async () => {
    const fp3 = sessionFilePath(PROJECT, CTX_SESSION);
    fs.writeFileSync(fp3, ctxLines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    const stat3 = fs.statSync(fp3);
    const meta3 = await buildMeta({ id: CTX_SESSION, projectId: PROJECT, filePath: fp3, size: stat3.size, mtimeMs: stat3.mtimeMs });
    const d = await readDetail(meta3, 0, 100);
    expect(d!.context).toHaveLength(4);
    expect(d!.context[0]).toMatchObject({ pct: 50, model: "claude-sonnet-4-5" });
    expect(d!.context[0].sidechain).toBeUndefined();
    expect(d!.context[1]).toMatchObject({ pct: 10, model: "claude-fable-5" });
    expect(d!.context[2]).toMatchObject({ model: "claude-fable-5", sidechain: true });
    expect(d!.context[3]).toMatchObject({ pct: 30, model: "claude-sonnet-4-5[1m]" });
    // Peak pct is the max of per-turn ratios (the 50% Sonnet turn), while the
    // raw token peak comes from the 300k [1m] turn — the pair proves the pct
    // is no longer rawMax/globalWindow.
    expect(meta3.peakContextPct).toBe(50);
    expect(meta3.peakContextTokens).toBe(300_000);
  });
});

describe("readDetail cache-rewrite flags", () => {
  const RW_SESSION = "s-rewrite";

  const billed = (
    uuid: string,
    parent: string | null,
    requestId: string,
    ts: string,
    usage: { input_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number },
  ) => ({
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
      usage,
    },
  });

  const rwLines = [
    human("u1", null, "start", "2026-01-01T10:00:00Z"),
    billed("a1", "u1", "r1", "2026-01-01T10:00:05Z",
      { input_tokens: 1000, cache_read_input_tokens: 0, cache_creation_input_tokens: 99_000 }),
    human("u2", "a1", "back after lunch", "2026-01-01T11:00:00Z"),
    // Idle rewrite, split into two parallel siblings sharing r2.
    billed("a2", "u2", "r2", "2026-01-01T11:00:05Z",
      { input_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 100_000 }),
    billed("a2b", "a2", "r2", "2026-01-01T11:00:06Z",
      { input_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 100_000 }),
  ];

  it("flags the rewrite on the request's first message only", async () => {
    const fp2 = sessionFilePath(PROJECT, RW_SESSION);
    fs.writeFileSync(fp2, rwLines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    const stat2 = fs.statSync(fp2);
    const meta2 = await buildMeta({ id: RW_SESSION, projectId: PROJECT, filePath: fp2, size: stat2.size, mtimeMs: stat2.mtimeMs });
    const d = await readDetail(meta2, 0, 100);
    const byUuid = new Map(d!.messages.map((m) => [m.uuid, m]));
    expect(byUuid.get("a1")!.cacheRewrite).toBeNull(); // first billed request
    const rw = byUuid.get("a2")!.cacheRewrite;
    expect(rw).not.toBeNull();
    expect(rw!.cause).toBe("idle");
    expect(rw!.rewrittenTokens).toBe(100_000);
    expect(byUuid.get("a2b")!.cacheRewrite).toBeNull(); // parallel sibling, same requestId
    expect(meta2.cacheRewriteCount).toBe(1);
    // Quick-nav list: one entry, located at the flagged message's view index.
    expect(d!.cacheRewrites).toHaveLength(1);
    expect(d!.cacheRewrites[0]).toMatchObject({ uuid: "a2", index: 3, cause: "idle" });
  });
});

describe("readDetail compaction markers", () => {
  const COMPACT_SESSION = "s-compact";

  const compactLines = [
    human("u1", null, "start", "2026-01-01T10:00:00Z"),
    assistant("a1", "u1", "c1", "2026-01-01T10:00:05Z"),
    { type: "system", subtype: "compact_boundary", timestamp: "2026-01-01T10:00:30Z",
      compactMetadata: { trigger: "auto", preTokens: 123_456 } },
    human("u2", "a1", "after compact", "2026-01-01T10:01:00Z"),
    assistant("a2", "u2", "c2", "2026-01-01T10:01:05Z"),
  ];

  it("collects a compact_boundary between two billed turns with its timestamp and trigger", async () => {
    const fp5 = sessionFilePath(PROJECT, COMPACT_SESSION);
    fs.writeFileSync(fp5, compactLines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    const stat5 = fs.statSync(fp5);
    const meta5 = await buildMeta({ id: COMPACT_SESSION, projectId: PROJECT, filePath: fp5, size: stat5.size, mtimeMs: stat5.mtimeMs });
    const d = await readDetail(meta5, 0, 100);
    expect(d!.compactions).toEqual([{ t: "2026-01-01T10:00:30Z", trigger: "auto" }]);
    expect(meta5.compactCount).toBe(1);
  });
});

describe("readDetail per-message token dedup", () => {
  const TOK_SESSION = "s-tokens";

  // One API response split over two JSONL lines sharing r1, each repeating the
  // FULL usage — like real multi-block responses (thinking + text + tool_use).
  const tokLines = [
    human("u1", null, "start", "2026-01-01T10:00:00Z"),
    assistant("a1", "u1", "r1", "2026-01-01T10:00:05Z",
      { usage: { input_tokens: 100, output_tokens: 480 } }),
    assistant("a1b", "a1", "r1", "2026-01-01T10:00:06Z",
      { usage: { input_tokens: 100, output_tokens: 480 } }),
    assistant("a2", "a1b", "r2", "2026-01-01T10:01:00Z",
      { usage: { input_tokens: 200, output_tokens: 10 } }),
  ];

  it("attaches usage to the request's first message only", async () => {
    const fp4 = sessionFilePath(PROJECT, TOK_SESSION);
    fs.writeFileSync(fp4, tokLines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    const stat4 = fs.statSync(fp4);
    const meta4 = await buildMeta({ id: TOK_SESSION, projectId: PROJECT, filePath: fp4, size: stat4.size, mtimeMs: stat4.mtimeMs });
    const d = await readDetail(meta4, 0, 100);
    const byUuid = new Map(d!.messages.map((m) => [m.uuid, m]));
    expect(byUuid.get("a1")!.tokens).toMatchObject({ input: 100, output: 480 });
    expect(byUuid.get("a1b")!.tokens).toBeNull(); // same requestId → deduped
    expect(byUuid.get("a2")!.tokens).toMatchObject({ input: 200, output: 10 });
    // The view sum now matches the deduped index totals.
    const viewOutput = d!.messages.reduce((a, m) => a + (m.tokens?.output ?? 0), 0);
    expect(viewOutput).toBe(meta4.tokens.output);
  });
});
