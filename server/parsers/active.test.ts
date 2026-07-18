import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

// CLAUDE_DIR is read at import time of claudeDir.ts, so set it BEFORE importing
// active.ts (dynamic import in beforeAll, mirroring agents.test.ts).
let dir: string;
let getActiveSession: typeof import("./active.ts").getActiveSession;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join((process.env.TMPDIR || "/tmp").replace(/\/+$/, ""), "maurice-active-"));
  // Encoded project dir name whose real path contains a hyphen that must NOT be
  // split into a path separator.
  const proj = path.join(dir, "projects", "-Users-me-my-project");
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(
    path.join(proj, "s1.jsonl"),
    JSON.stringify({
      type: "assistant",
      requestId: "r1",
      timestamp: "2026-01-01T10:00:00Z",
      cwd: "/Users/me/my-project",
      message: { model: "claude-sonnet-4-6", usage: { input_tokens: 10, output_tokens: 5 } },
    }) + "\n",
  );
  process.env.CLAUDE_DIR = dir;
  ({ getActiveSession } = await import("./active.ts"));
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("getActiveSession", () => {
  it("uses the captured cwd, not the lossy dash-decoded project id", async () => {
    const r = await getActiveSession();
    expect(r.active).toBe(true);
    // The dash decode would have produced "/Users/me/my/project".
    if (r.active) expect(r.projectPath).toBe("/Users/me/my-project");
  });
});
