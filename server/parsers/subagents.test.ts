import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// CLAUDE_DIR is read at import time of claudeDir.ts, so set it BEFORE importing
// sessions.ts (done via dynamic import in beforeAll).
let dir: string;
let listSubagents: typeof import("./sessions.ts").listSubagents;

const PROJECT = "-tmp-proj";
const SESSION = "s1";

// agent-multi: a real assistant turn — its model is reported.
// agent-interrupted: only a <synthetic> "session limit" message — no real model.
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
};

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "subagents-"));
  process.env.CLAUDE_DIR = dir;
  const subDir = path.join(dir, "projects", PROJECT, SESSION, "subagents");
  fs.mkdirSync(subDir, { recursive: true });
  for (const [ref, lines] of Object.entries(agents)) {
    fs.writeFileSync(path.join(subDir, `${ref}.jsonl`), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  }
  fs.writeFileSync(
    path.join(subDir, "agent-real.meta.json"),
    JSON.stringify({ agentType: "Explore", description: "do a thing", toolUseId: "t1" }),
  );
  ({ listSubagents } = await import("./sessions.ts"));
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("listSubagents", () => {
  it("reports the real models a subagent ran", () => {
    const refs = listSubagents(PROJECT, SESSION);
    const real = refs.find((r) => r.ref === "agent-real")!;
    expect(real.models).toEqual(["claude-haiku-4-5-20251001"]); // deduped
    expect(real.messageCount).toBe(3);
    expect(real.agentType).toBe("Explore");
  });

  it("returns no models for a subagent that only emitted a <synthetic> message", () => {
    const refs = listSubagents(PROJECT, SESSION);
    const interrupted = refs.find((r) => r.ref === "agent-interrupted")!;
    expect(interrupted.models).toEqual([]);
  });
});
