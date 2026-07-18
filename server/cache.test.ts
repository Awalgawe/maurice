import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

// CLAUDE_DIR is read at import time of claudeDir.ts, so set it BEFORE importing
// cache.ts (dynamic import in beforeAll, mirroring agents.test.ts). Both the
// search index (:memory:) and the metadata cache (_setCacheDirForTesting → temp
// dir) are redirected away from the real project-local .cache/, so a running dev
// server sharing that directory is never read, overwritten, or restored.
let dir: string;
let cacheDir: string;
let cacheFile: string;
let getIndex: typeof import("./cache.ts").getIndex;
let search: typeof import("./parsers/searchIndex.ts");

const assistantLine = (id: string, ts: string) =>
  JSON.stringify({
    type: "assistant",
    requestId: `r-${id}`,
    timestamp: ts,
    cwd: "/tmp/proj",
    message: { model: "claude-sonnet-4-6", usage: { input_tokens: 100, output_tokens: 50 } },
  });

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join((process.env.TMPDIR || "/tmp").replace(/\/+$/, ""), "maurice-cache-"));
  const proj = path.join(dir, "projects", "-tmp-proj");
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, "s1.jsonl"), assistantLine("1", "2026-01-01T10:00:00Z") + "\n");
  fs.writeFileSync(path.join(proj, "s2.jsonl"), assistantLine("2", "2026-01-02T10:00:00Z") + "\n");
  process.env.CLAUDE_DIR = dir;

  search = await import("./parsers/searchIndex.ts");
  search._resetForTesting(":memory:");
  const cache = await import("./cache.ts");
  getIndex = cache.getIndex;
  cacheDir = path.join(dir, ".cache");
  cacheFile = path.join(cacheDir, "index.json");
  cache._setCacheDirForTesting(cacheDir);
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("getIndex concurrency", () => {
  it("coalesces concurrent rebuilds onto a single in-flight promise", async () => {
    // Before the fix, overlapping rebuilds shared one SQLite connection/BEGIN and
    // could interleave or double-COMMIT. Coalesced calls return the same promise.
    const [a, b, c] = await Promise.all([getIndex(), getIndex(), getIndex()]);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(a.map((s) => s.id).sort()).toEqual(["s1", "s2"]);
  });

  it("rebuilds afresh once the in-flight rebuild has settled", async () => {
    const first = await getIndex();
    const second = await getIndex();
    // A new call after settle is a distinct rebuild (not the stale promise).
    expect(second).not.toBe(first);
    expect(second.map((s) => s.id).sort()).toEqual(["s1", "s2"]);
  });
});

describe("getIndex atomicity", () => {
  // Force a fresh rebuild (all files reparse → upserts run) with an empty cache
  // so the failure paths below actually exercise the transaction.
  const freshRebuild = () => {
    search._resetForTesting(":memory:");
    fs.rmSync(cacheFile, { force: true });
  };

  it("does not stamp the version or save the cache when an upsert fails", async () => {
    freshRebuild();
    search._setFailpointForTesting("upsert");
    await expect(getIndex()).rejects.toThrow(/upsert failure/);
    search._setFailpointForTesting(null);

    // A partial rebuild must never look up-to-date: no cache snapshot on disk...
    expect(fs.existsSync(cacheFile)).toBe(false);
    // ...and the next call retries and completes cleanly.
    const metas = await getIndex();
    expect(metas.map((s) => s.id).sort()).toEqual(["s1", "s2"]);
    expect(fs.existsSync(cacheFile)).toBe(true);
  });

  it("does not stamp the version or save the cache when the commit fails", async () => {
    freshRebuild();
    search._setFailpointForTesting("commit");
    await expect(getIndex()).rejects.toThrow(/commit failure/);
    search._setFailpointForTesting(null);
    expect(fs.existsSync(cacheFile)).toBe(false);

    const metas = await getIndex();
    expect(metas.map((s) => s.id).sort()).toEqual(["s1", "s2"]);
  });
});
