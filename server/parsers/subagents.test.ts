import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// CLAUDE_DIR is read at import time of claudeDir.ts, so set it BEFORE importing
// sessions.ts (done via dynamic import in beforeAll).
let dir: string;
let listSubagents: typeof import("./sessions.ts").listSubagents;
let sumSubagents: typeof import("./sessions.ts").sumSubagents;
let readSubagentDetail: typeof import("./sessions.ts").readSubagentDetail;
let reaggregateSubagentMeta: typeof import("./sessions.ts").reaggregateSubagentMeta;
let subagentsFingerprint: typeof import("../claudeDir.ts").subagentsFingerprint;

const PROJECT = "-tmp-proj";
const SESSION = "s1";
const SESSION_CYCLE = "s2";
const SESSION_DEEP = "s3";
const SESSION_REWRITE = "s4";
const SESSION_WORKFLOW = "s5";

const hz = (out: number, requestId: string) => ({
  type: "assistant",
  requestId,
  message: { model: "claude-haiku-4-5-20251001", usage: { output_tokens: out } },
});

// An assistant turn that spawns a subagent (Task/Agent tool_use with `toolId`).
const emit = (out: number, requestId: string, toolId: string) => ({
  type: "assistant",
  requestId,
  message: {
    model: "claude-haiku-4-5-20251001",
    usage: { output_tokens: out },
    content: [{ type: "tool_use", id: toolId, name: "Agent", input: {} }],
  },
});

// Session s3: a 3-level chain x → y → z (each spawns the next via toolUseId).
const deepAgents: Record<string, object[]> = {
  "agent-x": [{ type: "user", message: { role: "user", content: "Go" } }, emit(10, "rx", "tu-y")],
  "agent-y": [emit(20, "ry", "tu-z")],
  "agent-z": [hz(30, "rz")],
};
const deepMetas: Record<string, object> = {
  "agent-x": { agentType: "general-purpose", toolUseId: "tu-x-root" }, // root (id not emitted)
  "agent-y": { agentType: "Explore", toolUseId: "tu-y" }, // child of x
  "agent-z": { agentType: "Explore", toolUseId: "tu-z" }, // child of y
};

// Session s1 fixtures:
// - agent-real / agent-interrupted: legacy assertions (models detection).
// - agent-parent emits Agent tool_use "tu-child"; agent-child.meta.toolUseId
//   == "tu-child" → child of agent-parent (nested subagent).
// - agent-root.meta.toolUseId == "tu-main" (emitted by the main session, absent
//   from every transcript) → root. agent-orphan has no .meta.json → root.
const agents: Record<string, object[]> = {
  "agent-real": [
    { type: "user", message: { role: "user", content: "Go" } },
    { type: "assistant", message: { model: "claude-haiku-4-5-20251001", usage: {} } },
    { type: "assistant", message: { model: "claude-haiku-4-5-20251001", usage: {} } },
  ],
  "agent-interrupted": [
    { type: "user", message: { role: "user", content: "Go" } },
    { type: "assistant", message: { model: "<synthetic>", content: [{ type: "text", text: "session limit" }] } },
  ],
  "agent-parent": [
    { type: "user", message: { role: "user", content: "Go" } },
    hz(100, "r-parent"),
    {
      type: "assistant",
      requestId: "r-parent2",
      message: {
        model: "claude-haiku-4-5-20251001",
        usage: { output_tokens: 0 },
        content: [{ type: "tool_use", id: "tu-child", name: "Agent", input: {} }],
      },
    },
  ],
  "agent-child": [
    { type: "user", message: { role: "user", content: "Go" } },
    hz(200, "r-child"),
  ],
  "agent-root": [
    { type: "user", message: { role: "user", content: "Go" } },
    hz(50, "r-root"),
  ],
  "agent-orphan": [
    { type: "user", message: { role: "user", content: "Go" } },
    hz(70, "r-orphan"),
  ],
};

const metas: Record<string, object> = {
  "agent-real": { agentType: "Explore", description: "do a thing", toolUseId: "t1" },
  "agent-parent": { agentType: "general-purpose", description: "parent", toolUseId: "tu-main-parent" },
  "agent-child": { agentType: "Explore", description: "child", toolUseId: "tu-child" },
  "agent-root": { agentType: "Explore", description: "root", toolUseId: "tu-main" },
  // agent-orphan intentionally has no .meta.json.
};

// Session s2: two transcripts referencing each other's emitted ids → a cycle.
const cycleAgents: Record<string, object[]> = {
  "agent-a": [
    {
      type: "assistant",
      requestId: "ra",
      message: {
        model: "claude-haiku-4-5-20251001",
        usage: { output_tokens: 10 },
        content: [{ type: "tool_use", id: "id-b", name: "Agent", input: {} }],
      },
    },
  ],
  "agent-b": [
    {
      type: "assistant",
      requestId: "rb",
      message: {
        model: "claude-haiku-4-5-20251001",
        usage: { output_tokens: 20 },
        content: [{ type: "tool_use", id: "id-a", name: "Agent", input: {} }],
      },
    },
  ],
};
const cycleMetas: Record<string, object> = {
  "agent-a": { toolUseId: "id-a" }, // spawned by id-a, which agent-b emits
  "agent-b": { toolUseId: "id-b" }, // spawned by id-b, which agent-a emits
};

// Session s4: one subagent transcript with a lone idle cache rewrite, mirroring
// the fixture in sessions.test.ts's "buildMeta cache-rewrite aggregation".
const u = (input: number, cacheRead: number, cacheCreate: number) => ({
  input_tokens: input,
  cache_read_input_tokens: cacheRead,
  cache_creation_input_tokens: cacheCreate,
});
const rewriteAgents: Record<string, object[]> = {
  "agent-rw": [
    // First billed request: establishes the context, never flagged.
    { type: "assistant", requestId: "rw1", timestamp: "2026-01-01T10:00:00Z",
      message: { model: "claude-sonnet-4-6", usage: u(1000, 0, 99_000) } },
    // 15 min idle → rewrite: 100k re-written instead of read.
    { type: "assistant", requestId: "rw2", timestamp: "2026-01-01T10:15:00Z",
      message: { model: "claude-sonnet-4-6", usage: u(500, 0, 100_000) } },
  ],
};

function writeSession(session: string, ag: Record<string, object[]>, mt: Record<string, object>) {
  const subDir = path.join(dir, "projects", PROJECT, session, "subagents");
  fs.mkdirSync(subDir, { recursive: true });
  for (const [ref, lines] of Object.entries(ag)) {
    const fp = path.join(subDir, `${ref}.jsonl`);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  }
  for (const [ref, meta] of Object.entries(mt)) {
    fs.writeFileSync(path.join(subDir, `${ref}.meta.json`), JSON.stringify(meta));
  }
}

// Session s5: a workflow layout — one flat agent, one nested under
// workflows/wf_1/ (with its sibling meta), and a journal.jsonl event log that
// must NOT be parsed as a transcript.
const workflowAgents: Record<string, object[]> = {
  "agent-flat": [hz(10, "r-flat")],
  "workflows/wf_1/agent-w": [hz(40, "r-w")],
  "workflows/wf_1/journal": [{ type: "started", ts: "2026-01-01T10:00:00Z" }],
};
const workflowMetas: Record<string, object> = {
  "workflows/wf_1/agent-w": { agentType: "workflow-subagent", description: "wf agent" },
};

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "subagents-"));
  process.env.CLAUDE_DIR = dir;
  writeSession(SESSION, agents, metas);
  writeSession(SESSION_CYCLE, cycleAgents, cycleMetas);
  writeSession(SESSION_DEEP, deepAgents, deepMetas);
  writeSession(SESSION_REWRITE, rewriteAgents, {});
  writeSession(SESSION_WORKFLOW, workflowAgents, workflowMetas);
  ({ listSubagents, sumSubagents, readSubagentDetail, reaggregateSubagentMeta } = await import("./sessions.ts"));
  ({ subagentsFingerprint } = await import("../claudeDir.ts"));
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("listSubagents", () => {
  it("reports the real models a subagent ran", async () => {
    const refs = await listSubagents(PROJECT, SESSION);
    const real = refs.find((r) => r.ref === "agent-real")!;
    expect(real.models).toEqual(["claude-haiku-4-5-20251001"]); // deduped
    expect(real.messageCount).toBe(3);
    expect(real.agentType).toBe("Explore");
  });

  it("returns no models for a subagent that only emitted a <synthetic> message", async () => {
    const refs = await listSubagents(PROJECT, SESSION);
    const interrupted = refs.find((r) => r.ref === "agent-interrupted")!;
    expect(interrupted.models).toEqual([]);
  });

  it("computes own cost from usage (haiku: 5$/MTok output)", async () => {
    const refs = await listSubagents(PROJECT, SESSION);
    const child = refs.find((r) => r.ref === "agent-child")!;
    expect(child.estCostUSD).toBeCloseTo((200 * 5) / 1_000_000, 12);
    expect(child.tokens.output).toBe(200);
  });

  it("links a nested subagent via toolUseId and rolls its cost into the parent", async () => {
    const refs = await listSubagents(PROJECT, SESSION);
    const parent = refs.find((r) => r.ref === "agent-parent")!;
    const child = refs.find((r) => r.ref === "agent-child")!;
    expect(parent.childRefs).toEqual(["agent-child"]);
    // own cost excludes the child; with-children includes it.
    expect(parent.costWithChildrenUSD).toBeCloseTo(parent.estCostUSD + child.estCostUSD, 12);
    expect(parent.costWithChildrenUSD).toBeGreaterThan(parent.estCostUSD);
    expect(child.childRefs).toEqual([]);
  });

  it("treats a subagent with unknown/missing toolUseId as a root", async () => {
    const refs = await listSubagents(PROJECT, SESSION);
    const allChildren = new Set(refs.flatMap((r) => r.childRefs));
    // toolUseId points at an id emitted by the main session (not any transcript).
    expect(allChildren.has("agent-root")).toBe(false);
    // no .meta.json at all.
    expect(allChildren.has("agent-orphan")).toBe(false);
    expect(refs.find((r) => r.ref === "agent-orphan")!.toolUseId).toBeNull();
  });

  it("session aggregate = Σ own costs = Σ roots' with-descendants", async () => {
    const refs = await listSubagents(PROJECT, SESSION);
    const { subagentsCostUSD } = sumSubagents(refs);
    const flat = refs.reduce((a, r) => a + r.estCostUSD, 0);
    const children = new Set(refs.flatMap((r) => r.childRefs));
    const roots = refs.filter((r) => !children.has(r.ref));
    const viaRoots = roots.reduce((a, r) => a + r.costWithChildrenUSD, 0);
    expect(subagentsCostUSD).toBeCloseTo(flat, 12);
    expect(viaRoots).toBeCloseTo(flat, 12);
  });

  it("ventilates the aggregate per agentType, grouping missing agentType under \"(unknown)\"", async () => {
    const refs = await listSubagents(PROJECT, SESSION);
    const { subagentsByType, subagentsCostUSD } = sumSubagents(refs);
    // agent-real + agent-parent + agent-child + agent-root are all "Explore"
    // or "general-purpose" per their .meta.json; agent-orphan/agent-interrupted
    // have no .meta.json (Explore is agent-real's type, general-purpose is
    // agent-parent's) → grouped under "(unknown)".
    const explore = refs.filter((r) => r.agentType === "Explore");
    expect(subagentsByType.Explore.count).toBe(explore.length);
    expect(subagentsByType.Explore.costUSD).toBeCloseTo(
      explore.reduce((a, r) => a + r.estCostUSD, 0),
      12,
    );
    const unknown = refs.filter((r) => r.agentType === null);
    expect(subagentsByType["(unknown)"].count).toBe(unknown.length);
    // every bucket's cost sums back to the flat total (no double counting).
    const bucketTotal = Object.values(subagentsByType).reduce((a, b) => a + b.costUSD, 0);
    expect(bucketTotal).toBeCloseTo(subagentsCostUSD, 12);
  });

  it("fingerprint changes when a transcript grows (invalidates the cached aggregate)", () => {
    const file = path.join(dir, "projects", PROJECT, SESSION, "subagents", "agent-child.jsonl");
    const original = fs.readFileSync(file);
    const before = subagentsFingerprint(PROJECT, SESSION);
    fs.appendFileSync(file, JSON.stringify(hz(999, "r-grow")) + "\n");
    expect(subagentsFingerprint(PROJECT, SESSION)).not.toBe(before);
    fs.writeFileSync(file, original); // restore for order-independence
  });

  it("lists nested workflow agents with path refs and skips journal.jsonl", async () => {
    const refs = await listSubagents(PROJECT, SESSION_WORKFLOW);
    expect(new Set(refs.map((r) => r.ref))).toEqual(new Set(["agent-flat", "workflows/wf_1/agent-w"]));
    const w = refs.find((r) => r.ref === "workflows/wf_1/agent-w")!;
    expect(w.agentType).toBe("workflow-subagent"); // sibling meta resolved at depth
    expect(w.tokens.output).toBe(40);
  });

  it("reads a nested workflow agent's detail via its path ref", async () => {
    const d = (await readSubagentDetail(PROJECT, SESSION_WORKFLOW, "workflows/wf_1/agent-w"))!;
    expect(d.agentType).toBe("workflow-subagent");
    expect(d.tokens.output).toBe(40);
  });

  it("fingerprint covers nested transcripts but not journal.jsonl", () => {
    const before = subagentsFingerprint(PROJECT, SESSION_WORKFLOW);
    expect(before).toContain("workflows/wf_1/agent-w.jsonl");
    expect(before).not.toContain("journal.jsonl");
    const nested = path.join(dir, "projects", PROJECT, SESSION_WORKFLOW, "subagents", "workflows", "wf_1", "agent-w.jsonl");
    const original = fs.readFileSync(nested);
    fs.appendFileSync(nested, JSON.stringify(hz(999, "r-w2")) + "\n");
    expect(subagentsFingerprint(PROJECT, SESSION_WORKFLOW)).not.toBe(before);
    fs.writeFileSync(nested, original); // restore for order-independence
  });

  it("terminates on a subagent cycle without double-counting", async () => {
    const refs = await listSubagents(PROJECT, SESSION_CYCLE);
    const a = refs.find((r) => r.ref === "agent-a")!;
    // visited-set stops the a→b→a loop; with-children counts each node once.
    const ownA = (10 * 5) / 1_000_000;
    const ownB = (20 * 5) / 1_000_000;
    expect(a.costWithChildrenUSD).toBeCloseTo(ownA + ownB, 12);
  });
});

describe("readSubagentDetail", () => {
  it("returns null for a missing transcript", async () => {
    expect(await readSubagentDetail(PROJECT, SESSION, "agent-nope")).toBeNull();
  });

  it("carries the thread + context + own cost of the transcript", async () => {
    const d = (await readSubagentDetail(PROJECT, SESSION, "agent-parent"))!;
    expect(d.agentType).toBe("general-purpose");
    expect(d.messages.length).toBeGreaterThan(0);
    expect(Array.isArray(d.context)).toBe(true); // curve carried (empty here: output-only usage)
    expect(d.estCostUSD).toBeGreaterThan(0);
  });

  it("flattens ALL transitive descendants (x → y → z), not just direct children", async () => {
    const x = (await readSubagentDetail(PROJECT, SESSION_DEEP, "agent-x"))!;
    expect(new Set(x.subagents.map((s) => s.ref))).toEqual(new Set(["agent-y", "agent-z"]));
    // with-descendants cost spans the whole chain (10 + 20 + 30 output @ haiku 5$/MTok).
    expect(x.costWithChildrenUSD).toBeCloseTo(((10 + 20 + 30) * 5) / 1_000_000, 12);
  });

  it("reports the parent node for the back link (nested vs root)", async () => {
    const x = (await readSubagentDetail(PROJECT, SESSION_DEEP, "agent-x"))!;
    const y = (await readSubagentDetail(PROJECT, SESSION_DEEP, "agent-y"))!;
    const z = (await readSubagentDetail(PROJECT, SESSION_DEEP, "agent-z"))!;
    expect(x.parentRef).toBeNull(); // hangs off the session
    expect(x.parentAgentType).toBeNull();
    expect(y.parentRef).toBe("agent-x");
    expect(y.parentAgentType).toBe("general-purpose");
    expect(z.parentRef).toBe("agent-y");
    // a mid-chain node still exposes only its own subtree.
    expect(new Set(y.subagents.map((s) => s.ref))).toEqual(new Set(["agent-z"]));
    expect(z.subagents).toEqual([]);
  });

  it("splits own cost per component and prices its own cache-rewrite waste", async () => {
    const d = (await readSubagentDetail(PROJECT, SESSION_REWRITE, "agent-rw"))!;
    // Sonnet pricing: input 3, cacheCreate 3.75, cacheRead 0.3 $/MTok.
    expect(d.costByComponent.input).toBeCloseTo((1000 + 500) * 3 / 1_000_000, 12);
    expect(d.costByComponent.cacheCreate).toBeCloseTo((99_000 + 100_000) * 3.75 / 1_000_000, 12);
    expect(d.costByComponent.cacheRead).toBe(0);
    const sumOfComponents =
      d.costByComponent.input + d.costByComponent.output + d.costByComponent.cacheRead + d.costByComponent.cacheCreate;
    expect(sumOfComponents).toBeCloseTo(d.estCostUSD, 12);
    // 100k tokens re-written after a 15 min idle gap, at the write−read delta.
    expect(d.cacheRewriteWastedUSD).toBeCloseTo((100_000 * (3.75 - 0.3)) / 1_000_000, 10);
    expect(d.cacheRewriteWastedUSD).toBeLessThan(d.costByComponent.cacheCreate);
  });
});

describe("reaggregateSubagentMeta", () => {
  it("refreshes only the subagent aggregate, preserving every own-cost field", async () => {
    const prev = {
      id: SESSION_DEEP,
      estCostUSD: 42,
      skills: ["awa:x"],
      subagentCount: 99,
      subagentsCostUSD: 0,
    } as unknown as import("../../src/types.ts").SessionMeta;
    const meta = await reaggregateSubagentMeta(prev, PROJECT, SESSION_DEEP);
    // own fields untouched
    expect(meta.estCostUSD).toBe(42);
    expect(meta.skills).toEqual(["awa:x"]);
    // subagent aggregate refreshed from disk (3 agents, 10+20+30 output tokens)
    expect(meta.subagentCount).toBe(3);
    expect(meta.subagentsCostUSD).toBeCloseTo(((10 + 20 + 30) * 5) / 1_000_000, 12);
    expect(meta.subagentsTokens!.output).toBe(60);
    // deepAgents: agent-x is general-purpose, agent-y/agent-z are Explore.
    expect(meta.subagentsByType!["general-purpose"].count).toBe(1);
    expect(meta.subagentsByType!.Explore.count).toBe(2);
  });
});
