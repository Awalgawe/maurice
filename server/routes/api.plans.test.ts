import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import express from "express";

// Isolate from the real ~/.claude: throwaway CLAUDE_DIR (bound before api.ts
// imports plans.ts) and a stubbed session index for project-path resolution.
vi.hoisted(() => {
  process.env.CLAUDE_DIR =
    (process.env.TMPDIR || "/tmp").replace(/\/+$/, "") + "/maurice-routes-" + process.pid + "/.claude";
});
const state = vi.hoisted(() => ({ index: [] as any[] }));
vi.mock("../cache.ts", () => ({ getIndex: async () => state.index }));

import { api } from "./api.ts";
import { GLOBAL_PLANS_DIR } from "../parsers/plans.ts";

const ROOT = process.env.CLAUDE_DIR as string;
const HOME = path.dirname(ROOT);
const JSON_H = { "Content-Type": "application/json" };

let server: http.Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use("/api", api);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(() => {
  server?.close();
  fs.rmSync(HOME, { recursive: true, force: true });
});

beforeEach(() => {
  state.index = [];
  fs.rmSync(GLOBAL_PLANS_DIR, { recursive: true, force: true });
  fs.mkdirSync(GLOBAL_PLANS_DIR, { recursive: true });
});

const writeGlobal = (name: string, body: string) => fs.writeFileSync(path.join(GLOBAL_PLANS_DIR, name), body);
const globalExists = (name: string) => fs.existsSync(path.join(GLOBAL_PLANS_DIR, name));
const del = (body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}/api/plans`, { method: "DELETE", headers: { ...JSON_H, ...headers }, body: JSON.stringify(body) });
const patch = (body: unknown) =>
  fetch(`${base}/api/plans`, { method: "PATCH", headers: JSON_H, body: JSON.stringify(body) });

describe("GET /api/plans", () => {
  it("lists global plans with derived title and ticket", async () => {
    writeGlobal("WMP-1-foo.md", "# Foo plan\nbody");
    writeGlobal("clever-twirling-clover.md", "# Random\nbody");
    const r = await fetch(`${base}/api/plans`);
    expect(r.status).toBe(200);
    const d = (await r.json()) as any[];
    expect(d).toHaveLength(2);
    const foo = d.find((p) => p.filename === "WMP-1-foo.md");
    expect(foo).toMatchObject({ title: "Foo plan", ticket: "WMP-1", scope: "global" });
  });
});

describe("DELETE /api/plans", () => {
  it("rejects a cross-origin request (403) and keeps the file", async () => {
    writeGlobal("a.md", "# a");
    const r = await del({ scope: "global", filename: "a.md" }, { Origin: "http://evil.com" });
    expect(r.status).toBe(403);
    expect(globalExists("a.md")).toBe(true);
  });

  it("rejects a traversal filename (400)", async () => {
    expect((await del({ scope: "global", filename: "../escape.md" })).status).toBe(400);
  });

  it("rejects an unknown scope (400)", async () => {
    expect((await del({ scope: "bogus", filename: "a.md" })).status).toBe(400);
  });

  it("returns 404 for a missing file", async () => {
    expect((await del({ scope: "global", filename: "nope.md" })).status).toBe(404);
  });

  it("deletes an existing global plan (200)", async () => {
    writeGlobal("a.md", "# a");
    const r = await del({ scope: "global", filename: "a.md" });
    expect(r.status).toBe(200);
    expect(globalExists("a.md")).toBe(false);
  });
});

describe("PATCH /api/plans (rename)", () => {
  it("renames a plan and appends .md (200)", async () => {
    writeGlobal("old.md", "# old");
    const r = await patch({ scope: "global", filename: "old.md", newName: "new" });
    expect(r.status).toBe(200);
    expect(globalExists("new.md")).toBe(true);
    expect(globalExists("old.md")).toBe(false);
  });

  it("refuses to clobber an existing target (409) and leaves it intact", async () => {
    writeGlobal("a.md", "# a");
    writeGlobal("b.md", "# b-original");
    const r = await patch({ scope: "global", filename: "a.md", newName: "b.md" });
    expect(r.status).toBe(409);
    expect(fs.readFileSync(path.join(GLOBAL_PLANS_DIR, "b.md"), "utf8")).toBe("# b-original");
    expect(globalExists("a.md")).toBe(true);
  });

  it("rejects a cross-origin rename (403)", async () => {
    writeGlobal("a.md", "# a");
    const r = await fetch(`${base}/api/plans`, {
      method: "PATCH",
      headers: { ...JSON_H, Origin: "http://evil.com" },
      body: JSON.stringify({ scope: "global", filename: "a.md", newName: "b" }),
    });
    expect(r.status).toBe(403);
  });
});

describe("project-scope writes", () => {
  it("deletes a project plan resolved via the session index's cwd", async () => {
    const repo = path.join(HOME, "repo");
    const pdir = path.join(repo, ".claude", "plans");
    fs.mkdirSync(pdir, { recursive: true });
    fs.writeFileSync(path.join(pdir, "x.md"), "# x");
    state.index = [{ projectId: "p1", projectPath: repo }];
    const r = await del({ scope: "project", projectId: "p1", filename: "x.md" });
    expect(r.status).toBe(200);
    expect(fs.existsSync(path.join(pdir, "x.md"))).toBe(false);
  });

  it("returns 400 when the projectId is unknown to the index", async () => {
    state.index = [];
    expect((await del({ scope: "project", projectId: "ghost", filename: "x.md" })).status).toBe(400);
  });
});
