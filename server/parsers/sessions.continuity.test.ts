import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildMetaAndDocs } from "./sessions.ts";
import type { SessionFile } from "../claudeDir.ts";

/**
 * The requestId sequence is the key the cross-file continuation join rests on
 * (see SessionContinuity): it must be the transcript's own main-thread API
 * calls, in order, once each — a fork copy reproduces exactly that.
 */

const lines: Record<string, unknown>[] = [
  { uuid: "u0", type: "user", timestamp: "2026-09-08T08:00:00Z", cwd: "/tmp/proj", message: { role: "user", content: "go" } },
  // Two parallel tool calls of the same turn share one requestId.
  {
    uuid: "a1",
    type: "assistant",
    timestamp: "2026-09-08T08:00:01Z",
    requestId: "req_1",
    message: { id: "m1", role: "assistant", model: "claude-sonnet-4-6", content: [{ type: "tool_use", id: "t1", name: "Bash", input: {} }], usage: { input_tokens: 5, output_tokens: 1 } },
  },
  {
    uuid: "a2",
    type: "assistant",
    timestamp: "2026-09-08T08:00:02Z",
    requestId: "req_1",
    message: { id: "m1", role: "assistant", model: "claude-sonnet-4-6", content: [{ type: "tool_use", id: "t2", name: "Bash", input: {} }], usage: { input_tokens: 5, output_tokens: 1 } },
  },
  // A sidechain turn: its own cache/billing stream, and a re-run would break the
  // prefix relation — it must not enter the sequence.
  {
    uuid: "a3",
    type: "assistant",
    isSidechain: true,
    timestamp: "2026-09-08T08:00:03Z",
    requestId: "req_side",
    message: { id: "m2", role: "assistant", model: "claude-sonnet-4-6", content: [{ type: "text", text: "sub" }], usage: { input_tokens: 3, output_tokens: 1 } },
  },
  {
    uuid: "a4",
    type: "assistant",
    timestamp: "2026-09-08T08:00:04Z",
    requestId: "req_2",
    message: { id: "m3", role: "assistant", model: "claude-sonnet-4-6", content: [{ type: "text", text: "done" }], usage: { input_tokens: 6, output_tokens: 2 } },
  },
];

let dir: string;
let file: SessionFile;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "sess-continuity-"));
  const fp = path.join(dir, "s1.jsonl");
  fs.writeFileSync(fp, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  const stat = fs.statSync(fp);
  file = { id: "s1", projectId: "-tmp-proj", filePath: fp, size: stat.size, mtimeMs: stat.mtimeMs };
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("requestIds in buildMetaAndDocs", () => {
  it("records main-thread requests in order, once each, sidechains excluded", async () => {
    const { meta } = await buildMetaAndDocs(file);
    expect(meta.requestIds).toEqual(["req_1", "req_2"]);
  });

  it("is an empty sequence — never absent — for a transcript with no API call", async () => {
    const fp = path.join(dir, "s2.jsonl");
    fs.writeFileSync(fp, JSON.stringify(lines[0]) + "\n");
    const stat = fs.statSync(fp);
    const { meta } = await buildMetaAndDocs({ id: "s2", projectId: "-tmp-proj", filePath: fp, size: stat.size, mtimeMs: stat.mtimeMs });
    expect(meta.requestIds).toEqual([]);
  });
});
