import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

// CLAUDE_DIR is read at import time of claudeDir.ts, so set it BEFORE importing
// active.ts (dynamic import in beforeAll, mirroring agents.test.ts).
let dir: string;
let withCwdFile: string;
let noCwdFile: string;
let getActiveSession: typeof import("./active.ts").getActiveSession;

const NOW = Date.now();
const OLD = new Date(NOW - 120_000); // > ACTIVE_THRESHOLD_MS (60s) → not active
// Only one project is kept "active" at a time (single-file path is what the
// projectPath fallback exercises), toggled by touching mtimes.
function activate(file: string) {
  fs.utimesSync(file, new Date(), new Date());
}
function deactivate(file: string) {
  fs.utimesSync(file, OLD, OLD);
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join((process.env.TMPDIR || "/tmp").replace(/\/+$/, ""), "maurice-active-"));

  // Project A: real path carries a hyphen that must NOT be split into a separator.
  const projA = path.join(dir, "projects", "-Users-me-my-project");
  fs.mkdirSync(projA, { recursive: true });
  withCwdFile = path.join(projA, "s1.jsonl");
  fs.writeFileSync(
    withCwdFile,
    JSON.stringify({
      type: "assistant",
      requestId: "r1",
      timestamp: "2026-01-01T10:00:00Z",
      cwd: "/Users/me/my-project",
      message: { model: "claude-sonnet-4-6", usage: { input_tokens: 10, output_tokens: 5 } },
    }) + "\n",
  );

  // Project B: a hyphenated folder name and NO cwd line anywhere in the transcript.
  const projB = path.join(dir, "projects", "-Users-me-other-proj");
  fs.mkdirSync(projB, { recursive: true });
  noCwdFile = path.join(projB, "s1.jsonl");
  fs.writeFileSync(
    noCwdFile,
    JSON.stringify({
      type: "assistant",
      requestId: "r2",
      timestamp: "2026-01-01T10:00:00Z",
      message: { model: "claude-sonnet-4-6", usage: { input_tokens: 10, output_tokens: 5 } },
    }) + "\n",
  );

  process.env.CLAUDE_DIR = dir;
  ({ getActiveSession } = await import("./active.ts"));
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("getActiveSession", () => {
  it("uses the captured cwd, not the lossy dash-decoded project id", async () => {
    activate(withCwdFile);
    deactivate(noCwdFile);
    const r = await getActiveSession();
    expect(r.active).toBe(true);
    // The dash decode would have produced "/Users/me/my/project".
    if (r.active) expect(r.projectPath).toBe("/Users/me/my-project");
  });

  it("does not fabricate a path from dashes when no cwd is present", async () => {
    activate(noCwdFile);
    deactivate(withCwdFile);
    const r = await getActiveSession();
    expect(r.active).toBe(true);
    if (r.active) {
      // Must never invent segment boundaries: the buggy decode would yield
      // "/Users/me/other/proj", splitting the real "other-proj" folder.
      expect(r.projectPath).not.toContain("other/proj");
      expect(r.projectPath).toBe("-Users-me-other-proj");
    }
  });
});
