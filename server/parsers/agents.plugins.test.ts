import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

// CLAUDE_DIR is read at import time, so set it BEFORE importing agents.ts.
let dir: string;
let listDefinedAgents: typeof import("./agents.ts").listDefinedAgents;

const write = (file: string, content: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};
const agentMd = (name: string) => ["---", `name: ${name}`, "description: d", "---", ""].join("\n");

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join((process.env.TMPDIR || "/tmp").replace(/\/+$/, ""), "maurice-plugins-"));
  process.env.CLAUDE_DIR = dir;
  // Two cached versions of the same plugin (the cache keeps orphaned older ones).
  write(path.join(dir, "plugins", "cache", "mp", "awa", "1.0.0", "agents", "old-agent.md"), agentMd("old-agent"));
  write(path.join(dir, "plugins", "cache", "mp", "awa", "1.2.0", "agents", "new-agent.md"), agentMd("new-agent"));
  ({ listDefinedAgents } = await import("./agents.ts"));
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

// These two run in order: the first asserts the no-metadata fallback before the
// second writes installed_plugins.json.
describe("plugin version resolution", () => {
  it("without metadata, scans only the highest version dir (no stale duplicates)", () => {
    const names = listDefinedAgents([]).map((a) => a.name);
    expect(names).toContain("awa:new-agent");
    expect(names).not.toContain("awa:old-agent");
  });

  it("with installed_plugins.json, scans exactly the installed version", () => {
    // Pin the OLDER version as installed — this must override the latest-on-disk heuristic.
    write(
      path.join(dir, "plugins", "installed_plugins.json"),
      JSON.stringify({
        version: 2,
        plugins: {
          "awa@mp": [
            { scope: "user", installPath: path.join(dir, "plugins", "cache", "mp", "awa", "1.0.0"), version: "1.0.0" },
          ],
        },
      }),
    );
    const names = listDefinedAgents([]).map((a) => a.name);
    expect(names).toContain("awa:old-agent");
    expect(names).not.toContain("awa:new-agent");
  });
});
