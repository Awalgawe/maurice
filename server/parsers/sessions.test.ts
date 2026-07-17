import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildMeta, classifyMessage, hasRealError } from "./sessions.ts";
import type { SessionFile } from "../claudeDir.ts";
import type { ContentBlock } from "../../src/types.ts";

let dir: string;
let file: SessionFile;

const lines = [
  // First assistant turn: counted once, attributed to awa-foo.
  {
    type: "assistant",
    requestId: "r1",
    timestamp: "2026-01-01T10:00:00Z",
    gitBranch: "feature/WMP-123-thing",
    attributionSkill: "awa-foo",
    cwd: "/tmp/proj",
    message: { model: "claude-sonnet-4-6", usage: { input_tokens: 100, output_tokens: 50 } },
  },
  // Duplicate requestId: must NOT be double-counted.
  {
    type: "assistant",
    requestId: "r1",
    timestamp: "2026-01-01T10:00:01Z",
    message: { model: "claude-sonnet-4-6", usage: { input_tokens: 100, output_tokens: 50 } },
  },
  // Second turn with no skill: attributed to "(aucun)".
  {
    type: "assistant",
    requestId: "r2",
    timestamp: "2026-01-01T10:05:00Z",
    message: { model: "claude-sonnet-4-6", usage: { input_tokens: 200, output_tokens: 0 } },
  },
  // A system-injected synthetic message: its pseudo-model must be filtered out.
  {
    type: "assistant",
    requestId: "r3",
    timestamp: "2026-01-01T10:10:00Z",
    message: { model: "<synthetic>", content: [{ type: "text", text: "You've hit your session limit" }] },
  },
  // A user turn supplies the first prompt preview.
  { type: "user", timestamp: "2026-01-01T09:59:00Z", message: { role: "user", content: "Fix the bug please" } },
  // Generated title/name lines: repeated as the session evolves, last one wins.
  { type: "ai-title", aiTitle: "Early title", sessionId: "s1" },
  { type: "ai-title", aiTitle: "Fixing the bug", sessionId: "s1" },
  { type: "agent-name", agentName: "bug-fixer", sessionId: "s1" },
];

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "sess-"));
  const fp = path.join(dir, "s1.jsonl");
  fs.writeFileSync(fp, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  const stat = fs.statSync(fp);
  file = { id: "s1", projectId: "-tmp-proj", filePath: fp, size: stat.size, mtimeMs: stat.mtimeMs };
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("buildMeta", () => {
  it("dedups token usage by requestId", async () => {
    const m = await buildMeta(file);
    // r1 counted once (100/50) + r2 (200/0) — the duplicate r1 is ignored.
    expect(m.tokens.input).toBe(300);
    expect(m.tokens.output).toBe(50);
  });

  it("attributes tokens per active skill", async () => {
    const m = await buildMeta(file);
    expect(m.skillTokens["awa-foo"]).toBe(150); // 100 + 50
    expect(m.skillTokens["(aucun)"]).toBe(200);
  });

  it("detects a generic ticket from the branch name", async () => {
    const m = await buildMeta(file);
    expect(m.ticket).toBe("WMP-123");
  });

  it("captures the first real user prompt", async () => {
    const m = await buildMeta(file);
    expect(m.firstUserPrompt).toBe("Fix the bug please");
  });

  it("keeps the last ai-title and agent-name", async () => {
    const m = await buildMeta(file);
    expect(m.aiTitle).toBe("Fixing the bug");
    expect(m.agentName).toBe("bug-fixer");
  });

  it("attributes tokens/cost per model", async () => {
    const m = await buildMeta(file);
    // Both deduplicated turns use claude-sonnet-4-6 → all model tokens go there.
    expect(m.modelTokens["claude-sonnet-4-6"]).toBe(350); // 150 (r1) + 200 (r2)
    expect(m.modelCost["claude-sonnet-4-6"]).toBeGreaterThan(0);
  });

  it("excludes the <synthetic> pseudo-model from the model list and attribution", async () => {
    const m = await buildMeta(file);
    expect(m.models).toEqual(["claude-sonnet-4-6"]);
    expect(m.modelTokens).not.toHaveProperty("<synthetic>");
    expect(m.modelCost).not.toHaveProperty("<synthetic>");
  });

  // Day/activity attribution is computed in LOCAL time. Tests assert only
  // timezone-independent invariants — never hardcoded local day strings or
  // bucket counts (a fixture can straddle local midnight under some offset).
  it("conserves cost and activity totals across the per-day/heat breakdowns", async () => {
    const m = await buildMeta(file);
    const costSum = Object.values(m.costByDay).reduce((a, b) => a + b, 0);
    expect(costSum).toBeCloseTo(m.estCostUSD, 10);
    const heatSum = Object.values(m.activityHeat).reduce((a, b) => a + b, 0);
    expect(heatSum).toBe(m.messageCount);
    expect(m.activeDays.length).toBeGreaterThanOrEqual(1);
  });
});

describe("buildMeta per-day cost + activity attribution", () => {
  let ddir: string;
  let dfile: SessionFile;

  // Two billed turns 48h apart → always two distinct local days, whatever the
  // runner's timezone (a single fixed offset shifts both equally).
  const dlines = [
    { type: "assistant", requestId: "d1", timestamp: "2026-01-01T12:00:00Z",
      message: { model: "claude-sonnet-4-6", usage: { input_tokens: 100, output_tokens: 50 } } },
    { type: "assistant", requestId: "d2", timestamp: "2026-01-03T12:00:00Z",
      message: { model: "claude-sonnet-4-6", usage: { input_tokens: 200, output_tokens: 80 } } },
  ];

  beforeAll(() => {
    ddir = fs.mkdtempSync(path.join(os.tmpdir(), "sess-day-"));
    const fp = path.join(ddir, "d1.jsonl");
    fs.writeFileSync(fp, dlines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    const stat = fs.statSync(fp);
    dfile = { id: "d1", projectId: "-tmp-proj", filePath: fp, size: stat.size, mtimeMs: stat.mtimeMs };
  });

  afterAll(() => fs.rmSync(ddir, { recursive: true, force: true }));

  it("spreads cost across both days and lists both as active", async () => {
    const m = await buildMeta(dfile);
    expect(Object.keys(m.costByDay)).toHaveLength(2);
    expect(m.activeDays).toHaveLength(2);
    expect(Object.values(m.costByDay).every((c) => c > 0)).toBe(true);
    const sum = Object.values(m.costByDay).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(m.estCostUSD, 10);
    const heatSum = Object.values(m.activityHeat).reduce((a, b) => a + b, 0);
    expect(heatSum).toBe(m.messageCount); // 2 assistant turns
  });

  it("leaves aiTitle/agentName null when the lines are absent", async () => {
    const m = await buildMeta(dfile);
    expect(m.aiTitle).toBeNull();
    expect(m.agentName).toBeNull();
  });
});

describe("buildMeta cache-rewrite aggregation", () => {
  let rdir: string;
  let rfile: SessionFile;

  const u = (input: number, cacheRead: number, cacheCreate: number) => ({
    input_tokens: input,
    cache_read_input_tokens: cacheRead,
    cache_creation_input_tokens: cacheCreate,
  });

  const rlines = [
    // First billed request: establishes the context, never flagged.
    { type: "assistant", requestId: "r1", timestamp: "2026-01-01T10:00:00Z",
      message: { model: "claude-sonnet-4-6", usage: u(1000, 0, 99_000) } },
    // 15 min idle → full rewrite: 100k re-written instead of read.
    { type: "assistant", requestId: "r2", timestamp: "2026-01-01T10:15:00Z",
      message: { model: "claude-sonnet-4-6", usage: u(500, 0, 100_000) } },
    // Parallel sibling (same requestId): must not double-count the rewrite.
    { type: "assistant", requestId: "r2", timestamp: "2026-01-01T10:15:01Z",
      message: { model: "claude-sonnet-4-6", usage: u(500, 0, 100_000) } },
    // Sidechain with a rewrite-looking usage: separate cache stream, excluded.
    { type: "assistant", requestId: "r3", isSidechain: true, timestamp: "2026-01-01T10:15:30Z",
      message: { model: "claude-sonnet-4-6", usage: u(500, 0, 90_000) } },
    // Normal follow-up turn: previous context read back, not flagged.
    { type: "assistant", requestId: "r4", timestamp: "2026-01-01T10:16:00Z",
      message: { model: "claude-sonnet-4-6", usage: u(200, 100_500, 1_000) } },
  ];

  beforeAll(() => {
    rdir = fs.mkdtempSync(path.join(os.tmpdir(), "sess-rewrite-"));
    const fp = path.join(rdir, "r1.jsonl");
    fs.writeFileSync(fp, rlines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    const stat = fs.statSync(fp);
    rfile = { id: "r1", projectId: "-tmp-proj", filePath: fp, size: stat.size, mtimeMs: stat.mtimeMs };
  });

  afterAll(() => fs.rmSync(rdir, { recursive: true, force: true }));

  it("counts the idle rewrite once and prices its avoidable surcost", async () => {
    const m = await buildMeta(rfile);
    expect(m.cacheRewriteCount).toBe(1);
    // 100k tokens at the Sonnet write−read delta: (3.75 − 0.3) $/MTok.
    expect(m.cacheRewriteWastedUSD).toBeCloseTo((100_000 * (3.75 - 0.3)) / 1_000_000, 10);
  });
});

describe("buildMeta turn durations + API reliability", () => {
  let tdir: string;
  let tfile: SessionFile;

  // Two turn_duration lines 48h apart → always two distinct local days,
  // whatever the runner's timezone (mirrors the per-day cost fixture above).
  const tlines = [
    { type: "system", subtype: "turn_duration", durationMs: 60_000, messageCount: 4, timestamp: "2026-01-01T12:00:00Z" },
    { type: "system", subtype: "turn_duration", durationMs: 120_000, messageCount: 6, timestamp: "2026-01-03T12:00:00Z" },
    { type: "system", subtype: "api_error", error: { message: "overloaded" }, retryInMs: 2000, retryAttempt: 1, maxRetries: 3, timestamp: "2026-01-01T12:00:30Z" },
    { type: "assistant", timestamp: "2026-01-01T12:00:31Z", isApiErrorMessage: true, apiErrorStatus: 529,
      message: { model: "<synthetic>", content: [{ type: "text", text: "API Error" }] } },
    { type: "assistant", requestId: "t1", timestamp: "2026-01-01T12:01:00Z",
      message: { model: "claude-sonnet-4-6", usage: { input_tokens: 100, output_tokens: 50 } } },
  ];

  beforeAll(() => {
    tdir = fs.mkdtempSync(path.join(os.tmpdir(), "sess-turn-"));
    const fp = path.join(tdir, "t1.jsonl");
    fs.writeFileSync(fp, tlines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    const stat = fs.statSync(fp);
    tfile = { id: "t1", projectId: "-tmp-proj", filePath: fp, size: stat.size, mtimeMs: stat.mtimeMs };
  });

  afterAll(() => fs.rmSync(tdir, { recursive: true, force: true }));

  it("aggregates turn durations, their day bucketing, and API reliability counters", async () => {
    const m = await buildMeta(tfile);
    expect(m.turnCount).toBe(2);
    expect(m.totalTurnDurationMs).toBe(180_000);
    expect(m.medianTurnMs).toBe(60_000); // lower-middle of [60_000, 120_000]
    expect(Object.keys(m.turnDurationByDay ?? {})).toHaveLength(2);
    expect(Object.values(m.turnDurationByDay ?? {}).reduce((a, b) => a + b, 0)).toBe(180_000);
    expect(m.apiRetryCount).toBe(1);
    expect(m.apiErrorMessageCount).toBe(1);
  });

  it("reports empty-but-present fields when a session has none of these lines", async () => {
    const m = await buildMeta(file); // the main fixture at the top of this file
    expect(m.turnCount).toBe(0);
    expect(m.totalTurnDurationMs).toBe(0);
    expect(m.medianTurnMs).toBeNull();
    expect(m.turnDurationByDay).toEqual({});
    expect(m.apiRetryCount).toBe(0);
    expect(m.apiErrorMessageCount).toBe(0);
  });
});

describe("buildMeta friction metrics", () => {
  let frdir: string;
  let frfile: SessionFile;

  const frlines = [
    // Interrupted user turn: counted once.
    { type: "user", timestamp: "2026-01-01T10:00:00Z", interruptedMessageId: "msg-1",
      message: { role: "user", content: "wait, stop" } },
    // Two distinct denial kinds + one repeat of the first kind.
    { type: "user", timestamp: "2026-01-01T10:01:00Z", toolDenialKind: "user-rejected",
      message: { role: "user", content: "no" } },
    { type: "user", timestamp: "2026-01-01T10:02:00Z", toolDenialKind: "automode-blocked",
      message: { role: "user", content: "no" } },
    { type: "user", timestamp: "2026-01-01T10:03:00Z", toolDenialKind: "user-rejected",
      message: { role: "user", content: "no" } },
    // Prompt provenance: typed ×2, sdk ×1.
    { type: "user", timestamp: "2026-01-01T10:04:00Z", promptSource: "typed",
      message: { role: "user", content: "hello" } },
    { type: "user", timestamp: "2026-01-01T10:05:00Z", promptSource: "typed",
      message: { role: "user", content: "hello again" } },
    { type: "user", timestamp: "2026-01-01T10:06:00Z", promptSource: "sdk",
      message: { role: "user", content: "hello from sdk" } },
    // Permission-mode lines (no timestamp), with consecutive duplicates.
    { type: "permission-mode", permissionMode: "auto", sessionId: "fr1" },
    { type: "permission-mode", permissionMode: "auto", sessionId: "fr1" },
    { type: "permission-mode", permissionMode: "plan", sessionId: "fr1" },
    { type: "permission-mode", permissionMode: "plan", sessionId: "fr1" },
    { type: "permission-mode", permissionMode: "auto", sessionId: "fr1" },
  ];

  beforeAll(() => {
    frdir = fs.mkdtempSync(path.join(os.tmpdir(), "sess-friction-"));
    const fp = path.join(frdir, "fr1.jsonl");
    fs.writeFileSync(fp, frlines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    const stat = fs.statSync(fp);
    frfile = { id: "fr1", projectId: "-tmp-proj", filePath: fp, size: stat.size, mtimeMs: stat.mtimeMs };
  });

  afterAll(() => fs.rmSync(frdir, { recursive: true, force: true }));

  it("counts interruptions, denials by kind, prompt sources, and permission-mode transitions", async () => {
    const m = await buildMeta(frfile);
    expect(m.interruptionCount).toBe(1);
    expect(m.denialCounts).toEqual({ "user-rejected": 2, "automode-blocked": 1 });
    expect(m.promptCounts).toEqual({ typed: 2, sdk: 1 });
    expect([...(m.permissionModes ?? [])].sort()).toEqual(["auto", "plan"]);
    // auto→plan, plan→auto — the initial auto is the starting mode, not a change.
    expect(m.permissionModeChanges).toBe(2);
  });

  it("reports empty-but-present friction fields when a session has none of these lines", async () => {
    const m = await buildMeta(file); // the main fixture at the top of this file
    expect(m.interruptionCount).toBe(0);
    expect(m.denialCounts).toEqual({});
    expect(m.promptCounts).toEqual({});
    expect(m.permissionModes).toEqual([]);
    expect(m.permissionModeChanges).toBe(0);
  });
});

describe("buildMeta hook execution stats", () => {
  let hkdir: string;
  let hkfile: SessionFile;

  const hklines = [
    // Two hook_success on the same hookName: durationMs 100 (number) + "300" (string, proves coercion).
    { type: "attachment", timestamp: "2026-01-01T10:00:00Z",
      attachment: { type: "hook_success", hookName: "PostToolUse:Bash", durationMs: 100,
        command: "echo SUPER_SECRET_CMD_1", stdout: "ok" } },
    { type: "attachment", timestamp: "2026-01-01T10:00:01Z",
      attachment: { type: "hook_success", hookName: "PostToolUse:Bash", durationMs: "300",
        command: "echo SUPER_SECRET_CMD_2", stdout: "ok" } },
    // A different hookName, no durationMs.
    { type: "attachment", timestamp: "2026-01-01T10:00:02Z",
      attachment: { type: "hook_success", hookName: "Stop", command: "echo SUPER_SECRET_CMD_3" } },
    // Async response on the first hookName — counted separately from fires.
    { type: "attachment", timestamp: "2026-01-01T10:00:03Z",
      attachment: { type: "async_hook_response", hookName: "PostToolUse:Bash", processId: 42 } },
    // Non-blocking error on the second hookName.
    { type: "attachment", timestamp: "2026-01-01T10:00:04Z",
      attachment: { type: "hook_non_blocking_error", hookName: "Stop" } },
    // Two stop_hook_summary lines: one with an error, one without.
    { type: "system", subtype: "stop_hook_summary", timestamp: "2026-01-01T10:00:05Z", hookErrors: ["boom"] },
    { type: "system", subtype: "stop_hook_summary", timestamp: "2026-01-01T10:00:06Z", hookErrors: [] },
  ];

  beforeAll(() => {
    hkdir = fs.mkdtempSync(path.join(os.tmpdir(), "sess-hooks-"));
    const fp = path.join(hkdir, "hk1.jsonl");
    fs.writeFileSync(fp, hklines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    const stat = fs.statSync(fp);
    hkfile = { id: "hk1", projectId: "-tmp-proj", filePath: fp, size: stat.size, mtimeMs: stat.mtimeMs };
  });

  afterAll(() => fs.rmSync(hkdir, { recursive: true, force: true }));

  it("aggregates fires/duration/async/errors per hookName", async () => {
    const m = await buildMeta(hkfile);
    expect(m.hookStats).toEqual({
      "PostToolUse:Bash": { fires: 2, totalDurationMs: 400, asyncResponses: 1, errors: 0 },
      Stop: { fires: 1, totalDurationMs: 0, asyncResponses: 0, errors: 1 },
    });
  });

  it("counts stop_hook_summary runs and hook errors (array entries + non-blocking errors)", async () => {
    const m = await buildMeta(hkfile);
    expect(m.stopHookRuns).toBe(2);
    // 1 entry in the first stop_hook_summary's hookErrors + 1 hook_non_blocking_error.
    expect(m.hookErrorCount).toBe(2);
  });

  it("never stores command/stdout strings in the meta", async () => {
    const m = await buildMeta(hkfile);
    const serialized = JSON.stringify(m);
    expect(serialized).not.toContain("SUPER_SECRET_CMD");
  });

  it("reports empty hookStats and zero counters when a session has no hook lines", async () => {
    const m = await buildMeta(file); // the main fixture at the top of this file
    expect(m.hookStats).toEqual({});
    expect(m.stopHookRuns).toBe(0);
    expect(m.hookErrorCount).toBe(0);
  });
});

describe("buildMeta tool analytics, compaction, files touched", () => {
  let toldir: string;
  let tolfile: SessionFile;

  const tollines = [
    // First turn: two tool_use blocks — Bash + Read.
    { type: "assistant", timestamp: "2026-01-01T10:00:00Z",
      message: { model: "claude-sonnet-4-6", content: [
        { type: "tool_use", id: "tu1", name: "Bash", input: {} },
        { type: "tool_use", id: "tu2", name: "Read", input: {} },
      ] } },
    // Second turn reuses Bash.
    { type: "assistant", timestamp: "2026-01-01T10:01:00Z",
      message: { model: "claude-sonnet-4-6", content: [
        { type: "tool_use", id: "tu3", name: "Bash", input: {} },
      ] } },
    // Genuine Bash failure (tu1) — counted.
    { type: "user", timestamp: "2026-01-01T10:00:05Z",
      message: { role: "user", content: [
        { type: "tool_result", tool_use_id: "tu1", is_error: true, content: "boom" },
      ] } },
    // Denied Bash call (tu3, toolDenialKind set) — must NOT count as a tool error.
    { type: "user", timestamp: "2026-01-01T10:01:05Z", toolDenialKind: "user-rejected",
      message: { role: "user", content: [
        { type: "tool_result", tool_use_id: "tu3", is_error: true, content: "denied" },
      ] } },
    // One compaction.
    { type: "system", subtype: "compact_boundary", timestamp: "2026-01-01T10:02:00Z",
      compactMetadata: { trigger: "auto", preTokens: 123_456 } },
    // Two file-history-snapshot lines, overlapping keys: {a.ts,b.ts} then {b.ts,c.ts}.
    { type: "file-history-snapshot", timestamp: "2026-01-01T10:00:02Z",
      snapshot: { trackedFileBackups: { "a.ts": {}, "b.ts": {} } } },
    { type: "file-history-snapshot", timestamp: "2026-01-01T10:00:10Z",
      snapshot: { trackedFileBackups: { "b.ts": {}, "c.ts": {} } } },
  ];

  beforeAll(() => {
    toldir = fs.mkdtempSync(path.join(os.tmpdir(), "sess-tools-"));
    const fp = path.join(toldir, "tol1.jsonl");
    fs.writeFileSync(fp, tollines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    const stat = fs.statSync(fp);
    tolfile = { id: "tol1", projectId: "-tmp-proj", filePath: fp, size: stat.size, mtimeMs: stat.mtimeMs };
  });

  afterAll(() => fs.rmSync(toldir, { recursive: true, force: true }));

  it("tallies tool calls/errors, counts compactions, and unions touched files", async () => {
    const m = await buildMeta(tolfile);
    expect(m.toolCounts).toEqual({ Bash: 2, Read: 1 });
    expect(m.toolErrors).toEqual({ Bash: 1 });
    expect(m.compactCount).toBe(1);
    expect(m.filesTouchedCount).toBe(3);
    expect(m.filesTouched).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  it("reports empty-but-present fields when a session has none of these lines", async () => {
    const m = await buildMeta(file); // the main fixture at the top of this file
    expect(m.toolCounts).toEqual({});
    expect(m.toolErrors).toEqual({});
    expect(m.compactCount).toBe(0);
    expect(m.filesTouchedCount).toBe(0);
    expect(m.filesTouched).toEqual([]);
  });
});

describe("classifyMessage", () => {
  const text = (s: string): ContentBlock => ({ kind: "text", text: s });
  const toolResult = (toolUseId: string | null): ContentBlock => ({
    kind: "tool_result",
    isError: false,
    text: "output",
    toolUseId,
    images: [],
  });

  it("labels an assistant turn as assistant", () => {
    expect(classifyMessage({ type: "assistant" }, [text("hi")], new Map())).toBe("assistant");
  });

  it("labels a plain user text turn as human", () => {
    expect(classifyMessage({ type: "user" }, [text("fix this")], new Map())).toBe("human");
  });

  it("labels an isMeta turn as meta (even with text)", () => {
    expect(classifyMessage({ type: "user", isMeta: true }, [text("Base directory…")], new Map())).toBe("meta");
  });

  it("labels a tool_result-only user turn as tool_result", () => {
    const names = new Map([["t1", "Read"]]);
    expect(classifyMessage({ type: "user" }, [toolResult("t1")], names)).toBe("tool_result");
  });

  it("labels a tool_result from a Task/Agent tool_use as subagent", () => {
    expect(classifyMessage({ type: "user" }, [toolResult("a1")], new Map([["a1", "Agent"]]))).toBe("subagent");
    expect(classifyMessage({ type: "user" }, [toolResult("a2")], new Map([["a2", "Task"]]))).toBe("subagent");
  });

  it("treats an unknown tool_use id as an ordinary tool result", () => {
    expect(classifyMessage({ type: "user" }, [toolResult("missing")], new Map())).toBe("tool_result");
  });

  it("keeps a turn mixing text and tool_result as human", () => {
    const names = new Map([["t1", "Read"]]);
    expect(classifyMessage({ type: "user" }, [text("see"), toolResult("t1")], names)).toBe("human");
  });
});

describe("hasRealError", () => {
  const err = (content: any) => ({ type: "tool_result", is_error: true, content });
  const line = (content: any[], extra: Record<string, unknown> = {}) => ({
    type: "user",
    message: { role: "user", content },
    ...extra,
  });

  it("flags a genuine tool failure", () => {
    expect(hasRealError(line([err("Exit code 1\nboom")]))).toBe(true);
  });

  it("does NOT flag a user interruption (string content)", () => {
    expect(hasRealError(line([err("The user doesn't want to proceed with this tool use. The tool use was rejected")]))).toBe(false);
  });

  it("does NOT flag a user interruption (array content)", () => {
    expect(
      hasRealError(line([err([{ type: "text", text: "The user doesn't want to proceed with this tool use." }])])),
    ).toBe(false);
  });

  it("does NOT flag a structured tool denial, whatever its kind", () => {
    for (const kind of ["user-rejected", "automode-blocked", "automode-unavailable", "permission-rule"]) {
      expect(hasRealError(line([err("Permission denied")], { toolDenialKind: kind }))).toBe(false);
    }
  });

  it("does NOT flag a structured interruption (interruptedMessageId)", () => {
    expect(hasRealError(line([err("Interrupted")], { interruptedMessageId: "abc" }))).toBe(false);
  });

  it("is false when no tool_result is in error", () => {
    expect(hasRealError(line([{ type: "tool_result", is_error: false, content: "ok" }]))).toBe(false);
    expect(hasRealError(line([{ type: "text", text: "hi" }]))).toBe(false);
    expect(hasRealError(undefined)).toBe(false);
  });
});

describe("buildMeta error details", () => {
  let edir: string;
  let efile: SessionFile;

  const elines = [
    { type: "assistant", timestamp: "2026-01-01T10:00:00Z", cwd: "/tmp/proj",
      message: { model: "claude-sonnet-4-6", content: [{ type: "tool_use", id: "tu1", name: "Bash", input: {} }] } },
    { type: "user", timestamp: "2026-01-01T10:00:05Z",
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu1", is_error: true, content: "npm ERR! code ELIFECYCLE" }] } },
    { type: "assistant", timestamp: "2026-01-01T10:01:00Z",
      message: { model: "claude-sonnet-4-6", content: [{ type: "tool_use", id: "tu2", name: "Edit", input: {} }] } },
    { type: "user", timestamp: "2026-01-01T10:01:05Z",
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu2", is_error: true, content: [{ type: "text", text: "String to replace not found in file" }] }] } },
    // User interruption: is_error but must NOT be recorded as a failure.
    { type: "user", timestamp: "2026-01-01T10:02:00Z",
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu1", is_error: true, content: "The user doesn't want to proceed with this tool use. The tool use was rejected" }] } },
    // Structured denial (auto-mode block): is_error + toolDenialKind, excluded too.
    { type: "user", timestamp: "2026-01-01T10:03:00Z", toolDenialKind: "automode-blocked",
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu2", is_error: true, content: "Blocked by auto mode policy" }] } },
  ];

  beforeAll(() => {
    edir = fs.mkdtempSync(path.join(os.tmpdir(), "sess-err-"));
    const fp = path.join(edir, "e1.jsonl");
    fs.writeFileSync(fp, elines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    const stat = fs.statSync(fp);
    efile = { id: "e1", projectId: "-tmp-proj", filePath: fp, size: stat.size, mtimeMs: stat.mtimeMs };
  });

  afterAll(() => fs.rmSync(edir, { recursive: true, force: true }));

  it("records each genuine failure with its tool, timestamp and excerpt", async () => {
    const m = await buildMeta(efile);
    expect(m.errorCount).toBe(2); // the interruption is excluded
    expect(m.errors).toHaveLength(2);
    expect(m.errors[0]).toMatchObject({ tool: "Bash", ts: "2026-01-01T10:00:05Z" });
    expect(m.errors[0].excerpt).toContain("npm ERR!");
    expect(m.errors[1]).toMatchObject({ tool: "Edit", ts: "2026-01-01T10:01:05Z" });
    expect(m.errors[1].excerpt).toContain("String to replace not found");
  });

  it("does not record a user interruption as a failure", async () => {
    const m = await buildMeta(efile);
    expect(m.errors.some((e) => e.excerpt.includes("rejected"))).toBe(false);
  });

  it("does not record a structured tool denial as a failure", async () => {
    const m = await buildMeta(efile);
    expect(m.errors.some((e) => e.excerpt.includes("auto mode"))).toBe(false);
  });
});
