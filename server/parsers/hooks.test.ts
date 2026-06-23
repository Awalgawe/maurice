import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Point CLAUDE_DIR at a throwaway dir (ending in /.claude so the $HOME dedup
// case is reproducible) BEFORE hooks.ts binds GLOBAL_SETTINGS, and stub the
// session index so listHooks() never touches the real ~/.claude.
vi.hoisted(() => {
  process.env.CLAUDE_DIR =
    (process.env.TMPDIR || "/tmp").replace(/\/+$/, "") + "/maurice-hooks-" + process.pid + "/.claude";
});
const state = vi.hoisted(() => ({ index: [] as any[] }));
vi.mock("../cache.ts", () => ({ getIndex: async () => state.index }));

import { readSettingsHooks, listHooks, GLOBAL_SETTINGS, GLOBAL_SETTINGS_LOCAL } from "./hooks.ts";

const ROOT = process.env.CLAUDE_DIR as string; // .../maurice-hooks-<pid>/.claude
const HOME = path.dirname(ROOT); // the dir whose .claude IS the global dir

describe("readSettingsHooks", () => {
  const tmp = path.join(HOME, "scratch.json");
  afterAll(() => fs.rmSync(tmp, { force: true }));
  const write = (obj: unknown) => {
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    fs.writeFileSync(tmp, typeof obj === "string" ? obj : JSON.stringify(obj));
  };

  it("flattens events × matchers × commands into rows", () => {
    write({
      hooks: {
        Stop: [{ matcher: "", hooks: [{ type: "command", command: "node a.cjs", async: true }] }],
        PreToolUse: [
          { matcher: "Bash", hooks: [{ type: "command", command: "guard.sh", timeout: 5 }] },
        ],
      },
    });
    const rows = readSettingsHooks(tmp, "global", null, null);
    expect(rows).toHaveLength(2);
    const stop = rows.find((r) => r.event === "Stop")!;
    expect(stop).toMatchObject({ matcher: "", command: "node a.cjs", async: true, timeout: null, scope: "global" });
    const pre = rows.find((r) => r.event === "PreToolUse")!;
    expect(pre).toMatchObject({ matcher: "Bash", command: "guard.sh", async: false, timeout: 5 });
  });

  it("returns [] for a missing file, malformed JSON, or no hooks key", () => {
    expect(readSettingsHooks(path.join(HOME, "nope.json"), "global", null, null)).toEqual([]);
    write("{ not json");
    expect(readSettingsHooks(tmp, "global", null, null)).toEqual([]);
    write({ permissions: { allow: ["Bash"] } }); // e.g. a settings.local.json with no hooks
    expect(readSettingsHooks(tmp, "global", null, null)).toEqual([]);
  });
});

describe("listHooks (fixtures)", () => {
  const writeJson = (file: string, obj: unknown) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(obj));
  };
  beforeEach(() => {
    state.index = [];
    fs.rmSync(ROOT, { recursive: true, force: true });
    fs.mkdirSync(ROOT, { recursive: true });
  });
  afterAll(() => fs.rmSync(HOME, { recursive: true, force: true }));

  it("reads global settings + settings.local, tagging scope", async () => {
    writeJson(GLOBAL_SETTINGS, { hooks: { Stop: [{ matcher: "", hooks: [{ type: "command", command: "g" }] }] } });
    writeJson(GLOBAL_SETTINGS_LOCAL, { hooks: { Notification: [{ matcher: "", hooks: [{ command: "l" }] }] } });
    const out = await listHooks();
    expect(out.map((h) => h.scope).sort()).toEqual(["global", "global-local"]);
  });

  it("includes project settings resolved from the session index cwd", async () => {
    const repo = path.join(HOME, "repo-a");
    writeJson(path.join(repo, ".claude", "settings.json"), {
      hooks: { PostToolUse: [{ matcher: "", hooks: [{ command: "p" }] }] },
    });
    state.index = [{ projectId: "p1", projectPath: repo }];
    const out = await listHooks();
    const proj = out.find((h) => h.scope === "project")!;
    expect(proj.event).toBe("PostToolUse");
    expect(proj.projectLabel).toContain("repo-a");
    expect(proj.projectId).toBe("p1");
  });

  it("does not read the global dir twice when a project's cwd is its parent ($HOME)", async () => {
    writeJson(GLOBAL_SETTINGS, { hooks: { Stop: [{ matcher: "", hooks: [{ command: "once" }] }] } });
    state.index = [{ projectId: "home", projectPath: HOME }]; // HOME/.claude === global dir
    const out = await listHooks();
    expect(out.filter((h) => h.command === "once")).toHaveLength(1);
    expect(out[0].scope).toBe("global");
  });

  it("sorts by event then scope", async () => {
    writeJson(GLOBAL_SETTINGS, {
      hooks: {
        Stop: [{ matcher: "", hooks: [{ command: "s" }] }],
        Notification: [{ matcher: "", hooks: [{ command: "n" }] }],
      },
    });
    const out = await listHooks();
    expect(out.map((h) => h.event)).toEqual(["Notification", "Stop"]);
  });
});
