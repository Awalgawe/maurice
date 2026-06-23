import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Point CLAUDE_DIR at a throwaway dir (ending in /.claude so the $HOME dedup
// case is reproducible) BEFORE plans.ts binds GLOBAL_PLANS_DIR, and stub the
// session index so listPlans() never touches the real ~/.claude.
vi.hoisted(() => {
  process.env.CLAUDE_DIR =
    (process.env.TMPDIR || "/tmp").replace(/\/+$/, "") + "/maurice-list-" + process.pid + "/.claude";
});
const state = vi.hoisted(() => ({ index: [] as any[] }));
vi.mock("../cache.ts", () => ({ getIndex: async () => state.index }));

import { extractTitle, isSafePlanFilename, resolvePlanPath, extractTicket, listPlans, GLOBAL_PLANS_DIR } from "./plans.ts";

const ROOT = process.env.CLAUDE_DIR as string; // .../maurice-list-<pid>/.claude
const HOME = path.dirname(ROOT); // the dir whose .claude/plans IS the global dir

describe("extractTitle", () => {
  it("returns the first '# heading'", () => {
    expect(extractTitle("# WMP-39188: Follow-up fixes\n## Section\nbody")).toBe("WMP-39188: Follow-up fixes");
  });

  it("ignores '##' sub-headings and finds the top-level one anywhere", () => {
    expect(extractTitle("intro line\n# The Plan\ntext")).toBe("The Plan");
  });

  it("returns null when there is no '# heading'", () => {
    expect(extractTitle("## only a sub-heading\nplain text")).toBeNull();
    expect(extractTitle("no headings at all")).toBeNull();
  });
});

describe("isSafePlanFilename", () => {
  it("accepts a plain .md basename", () => {
    expect(isSafePlanFilename("clever-twirling-clover.md")).toBe(true);
  });

  it("rejects traversal, separators, non-md and non-strings", () => {
    expect(isSafePlanFilename("../escape.md")).toBe(false);
    expect(isSafePlanFilename("sub/dir.md")).toBe(false);
    expect(isSafePlanFilename("note.txt")).toBe(false);
    expect(isSafePlanFilename("")).toBe(false);
    expect(isSafePlanFilename(42)).toBe(false);
  });
});

describe("resolvePlanPath", () => {
  it("resolves a global plan inside the global plans dir", () => {
    expect(resolvePlanPath("global", "a.md")).toBe(path.join(GLOBAL_PLANS_DIR, "a.md"));
  });

  it("resolves a project plan under <cwd>/.claude/plans", () => {
    expect(resolvePlanPath("project", "a.md", "/repo/x")).toBe(path.join("/repo/x", ".claude", "plans", "a.md"));
  });

  it("returns null for traversal, missing project path, or unknown scope", () => {
    expect(resolvePlanPath("global", "../escape.md")).toBeNull();
    expect(resolvePlanPath("project", "a.md")).toBeNull(); // no projectPath
    expect(resolvePlanPath("bogus", "a.md")).toBeNull();
  });
});

describe("extractTicket", () => {
  it("prefers the ticket key from the filename", () => {
    expect(extractTicket("WMP-39530-add-showtime.md", "Add showtime updated_at")).toBe("WMP-39530");
  });

  it("falls back to an uppercase ticket key in the title", () => {
    expect(extractTicket("dapper-taco.md", "# WMP-39188: Follow-up fixes")).toBe("WMP-39188");
  });

  it("does not match lowercase model-like tokens in the title", () => {
    expect(extractTicket("random-slug.md", "Passer à Opus-4")).toBeNull();
  });

  it("returns null when there is no ticket anywhere", () => {
    expect(extractTicket("clever-twirling-clover.md", "Some plain title")).toBeNull();
  });
});

describe("listPlans (fixtures)", () => {
  beforeEach(() => {
    state.index = [];
    fs.rmSync(GLOBAL_PLANS_DIR, { recursive: true, force: true });
    fs.mkdirSync(GLOBAL_PLANS_DIR, { recursive: true });
  });
  afterAll(() => fs.rmSync(HOME, { recursive: true, force: true }));

  const writeGlobal = (name: string, body: string, mtimeSec?: number) => {
    const p = path.join(GLOBAL_PLANS_DIR, name);
    fs.writeFileSync(p, body);
    if (mtimeSec !== undefined) fs.utimesSync(p, mtimeSec, mtimeSec);
  };

  it("reads global plans, derives title/ticket, and marks scope=global", async () => {
    writeGlobal("WMP-42-thing.md", "# Do the thing\nbody");
    writeGlobal("clever-twirling-clover.md", "intro\n# Random plan\nmore");
    const out = await listPlans();
    expect(out).toHaveLength(2);
    const wmp = out.find((p) => p.filename === "WMP-42-thing.md")!;
    expect(wmp.scope).toBe("global");
    expect(wmp.title).toBe("Do the thing");
    expect(wmp.ticket).toBe("WMP-42");
    expect(out.find((p) => p.filename === "clever-twirling-clover.md")!.ticket).toBeNull();
  });

  it("sorts by mtime descending (most recent first)", async () => {
    writeGlobal("old.md", "# old", 1_000);
    writeGlobal("mid.md", "# mid", 2_000);
    writeGlobal("new.md", "# new", 3_000);
    const out = await listPlans();
    expect(out.map((p) => p.filename)).toEqual(["new.md", "mid.md", "old.md"]);
  });

  it("includes project plans resolved from the session index's cwd", async () => {
    const repo = path.join(HOME, "repo-a");
    fs.mkdirSync(path.join(repo, ".claude", "plans"), { recursive: true });
    fs.writeFileSync(path.join(repo, ".claude", "plans", "feat.md"), "# A feature");
    state.index = [{ projectId: "p1", projectPath: repo }];
    const out = await listPlans();
    const feat = out.find((p) => p.filename === "feat.md")!;
    expect(feat.scope).toBe("project");
    expect(feat.projectLabel).toContain("repo-a");
  });

  it("does not list the global dir twice when a project's cwd is its parent ($HOME)", async () => {
    writeGlobal("only-once.md", "# Only once");
    state.index = [{ projectId: "home", projectPath: HOME }]; // HOME/.claude/plans === global dir
    const out = await listPlans();
    expect(out.filter((p) => p.filename === "only-once.md")).toHaveLength(1);
    expect(out[0].scope).toBe("global");
  });
});
