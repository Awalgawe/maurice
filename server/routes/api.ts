import express, { Router } from "express";
import readline from "node:readline";
import fs from "node:fs";
import { execFile } from "node:child_process";
import path from "node:path";
import { getIndex } from "../cache.ts";
import { readDetail, readSubagentDetail } from "../parsers/sessions.ts";
import { listMemories } from "../parsers/memory.ts";
import { listPlans, resolvePlanPath, resolveProjectPath } from "../parsers/plans.ts";
import { listHooks } from "../parsers/hooks.ts";
import { buildAgentRows } from "../parsers/agents.ts";
import { getActiveSession } from "../parsers/active.ts";
import { listBilans, readBilan } from "../parsers/bilans.ts";
import { sessionFilePath, subagentsDir, PROJECTS_DIR } from "../claudeDir.ts";
import { searchDocs } from "../parsers/searchIndex.ts";
import { computeFacets } from "../facets.ts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../mcp.ts";
import type { Facets, McpInfo, McpToolDoc, McpToolParam, SearchHit, SessionMeta } from "../../src/types.ts";

export const api = Router();

const PERF = !!process.env.PERF;

api.get("/sessions", async (_req, res) => {
  const index = await getIndex();
  res.json(index);
});

api.get("/active", async (_req, res) => {
  res.json(await getActiveSession());
});

api.get("/memories", (req, res) => {
  const { sessionId } = req.query;
  let memories = listMemories();
  if (sessionId) memories = memories.filter((m) => m.originSessionId === sessionId);
  res.json(memories);
});

api.delete("/memories", express.json(), (req, res) => {
  if (!isLoopbackOrigin(req.get("origin"))) {
    return res.status(403).json({ error: "cross-origin requests are not allowed" });
  }
  const { projectId, filename } = req.body ?? {};
  if (!projectId || !filename || typeof projectId !== "string" || typeof filename !== "string") {
    return res.status(400).json({ error: "missing projectId or filename" });
  }
  if (/[/\\]/.test(filename) || filename.includes("..") || /[/\\]/.test(projectId) || projectId.includes("..")) {
    return res.status(400).json({ error: "invalid projectId or filename" });
  }
  const filePath = path.resolve(PROJECTS_DIR, projectId, "memory", filename);
  const base = path.resolve(PROJECTS_DIR);
  if (!filePath.startsWith(base + path.sep)) {
    return res.status(403).json({ error: "path not allowed" });
  }
  try {
    fs.unlinkSync(filePath);
  } catch (e: any) {
    if (e.code === "ENOENT") return res.status(404).json({ error: "file not found" });
    return res.status(500).json({ error: e.message });
  }
  // Remove the corresponding entry from MEMORY.md if present (non-critical).
  const memoryMd = path.join(path.dirname(filePath), "MEMORY.md");
  try {
    const content = fs.readFileSync(memoryMd, "utf8");
    const updated = content.split("\n").filter((l) => !l.includes(`(${filename})`)).join("\n");
    fs.writeFileSync(memoryMd, updated, "utf8");
  } catch { /* ignore */ }
  res.json({ ok: true });
});

api.get("/plans", async (_req, res) => {
  res.json(await listPlans());
});

api.get("/hooks", async (_req, res) => {
  res.json(await listHooks());
});

api.get("/agents", async (_req, res) => {
  res.json({ agents: buildAgentRows(await getIndex()) });
});

// Self-documentation for the MCP server. The tool list is pulled from the SAME
// createMcpServer() definitions an MCP client would see (via an in-memory
// round-trip), so this page can never drift from what the server actually
// exposes. Tools are static, so memoize the first computation.
let mcpInfoMemo: McpInfo | null = null;

function describeParams(schema: unknown): McpToolParam[] {
  const s = schema as { properties?: Record<string, any>; required?: string[] } | undefined;
  if (!s?.properties) return [];
  const required = new Set(s.required ?? []);
  return Object.entries(s.properties).map(([name, def]) => {
    const bits: string[] = [];
    if (def.minimum !== undefined || def.maximum !== undefined) {
      bits.push(`${def.minimum ?? "−∞"}–${def.maximum ?? "∞"}`);
    }
    if (def.minLength !== undefined) bits.push(`min ${def.minLength} chars`);
    if (Array.isArray(def.enum)) bits.push(def.enum.join(" | "));
    return {
      name,
      type: typeof def.type === "string" ? def.type : "any",
      required: required.has(name),
      description: typeof def.description === "string" ? def.description : undefined,
      constraints: bits.length ? bits.join(", ") : undefined,
    } satisfies McpToolParam;
  });
}

api.get("/mcp-tools", async (_req, res) => {
  if (mcpInfoMemo) return res.json(mcpInfoMemo);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer();
  const client = new Client({ name: "maurice-docs", version: "0" });
  try {
    await Promise.all([server.connect(serverT), client.connect(clientT)]);
    const { tools } = await client.listTools();
    const docs: McpToolDoc[] = tools.map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      params: describeParams(t.inputSchema),
    }));
    mcpInfoMemo = { port: Number(process.env.PORT || 5174), tools: docs };
    res.json(mcpInfoMemo);
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "failed to build MCP tool list" });
  } finally {
    await client.close();
    await server.close();
  }
});

// Resolve the trusted plans dir for a write request: global → ~/.claude/plans,
// project → the cwd captured in the session index (never a client-supplied path).
async function planTargetPath(scope: unknown, projectId: unknown, filename: string): Promise<string | null> {
  if (scope === "global") return resolvePlanPath("global", filename);
  if (scope === "project") {
    if (typeof projectId !== "string") return null;
    const projectPath = await resolveProjectPath(projectId);
    if (!projectPath) return null;
    return resolvePlanPath("project", filename, projectPath);
  }
  return null;
}

// Deleting/renaming a plan is the second sanctioned write (after memory deletion):
// loopback-only origin, basename confined to its plans dir. See AGENTS.md.
api.delete("/plans", express.json(), async (req, res) => {
  if (!isLoopbackOrigin(req.get("origin"))) {
    return res.status(403).json({ error: "cross-origin requests are not allowed" });
  }
  const { scope, projectId, filename } = req.body ?? {};
  if (typeof filename !== "string") return res.status(400).json({ error: "missing filename" });
  const filePath = await planTargetPath(scope, projectId, filename);
  if (!filePath) return res.status(400).json({ error: "invalid scope, project or filename" });
  try {
    fs.unlinkSync(filePath);
  } catch (e: any) {
    if (e.code === "ENOENT") return res.status(404).json({ error: "file not found" });
    return res.status(500).json({ error: e.message });
  }
  res.json({ ok: true });
});

api.patch("/plans", express.json(), async (req, res) => {
  if (!isLoopbackOrigin(req.get("origin"))) {
    return res.status(403).json({ error: "cross-origin requests are not allowed" });
  }
  const { scope, projectId, filename, newName } = req.body ?? {};
  if (typeof filename !== "string" || typeof newName !== "string" || !newName.trim()) {
    return res.status(400).json({ error: "missing filename or newName" });
  }
  const target = newName.endsWith(".md") ? newName : `${newName}.md`;
  const from = await planTargetPath(scope, projectId, filename);
  const to = await planTargetPath(scope, projectId, target);
  if (!from || !to) return res.status(400).json({ error: "invalid scope, project or filename" });
  if (!fs.existsSync(from)) return res.status(404).json({ error: "file not found" });
  if (fs.existsSync(to)) return res.status(409).json({ error: "target already exists" });
  try {
    fs.renameSync(from, to);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
  res.json({ ok: true });
});

// Facets only change when the index is rebuilt. getIndex() returns the same
// array reference until invalidated, so identity equality is a safe cache key.
let facetsMemo: { src: SessionMeta[]; facets: Facets } | null = null;

api.get("/filters", async (_req, res) => {
  const index = await getIndex();
  if (facetsMemo && facetsMemo.src === index) return res.json(facetsMemo.facets);

  const facets = computeFacets(index);
  facetsMemo = { src: index, facets };
  res.json(facets);
});

async function findMeta(id: string): Promise<SessionMeta | undefined> {
  const index = await getIndex();
  return index.find((s) => s.id === id);
}

api.get("/sessions/:id", async (req, res) => {
  const meta = await findMeta(req.params.id);
  if (!meta) return res.status(404).json({ error: "session not found" });
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
  const branch = typeof req.query.branch === "string" && req.query.branch ? req.query.branch : null;
  const detail = await readDetail(meta, offset, limit, branch);
  if (!detail) return res.status(404).json({ error: "branch not found" });
  res.json(detail);
});

api.get("/sessions/:id/subagents/:ref", async (req, res) => {
  const meta = await findMeta(req.params.id);
  if (!meta) return res.status(404).json({ error: "session not found" });
  // Confine ref inside the session's subagents dir (AGENTS.md). Nested
  // workflow refs are path-shaped ("workflows/wf_x/agent-y") — they arrive
  // %2F-encoded in the single :ref segment — so the guard is resolution-based,
  // not a bare separator reject.
  const ref = req.params.ref;
  const dir = subagentsDir(meta.projectId, meta.id);
  const resolved = path.resolve(dir, `${ref}.jsonl`);
  if (ref.includes("\\") || !resolved.startsWith(dir + path.sep)) {
    return res.status(400).json({ error: "invalid ref" });
  }
  const detail = await readSubagentDetail(meta.projectId, meta.id, ref);
  if (!detail) return res.status(404).json({ error: "subagent not found" });
  res.json(detail);
});

api.get("/bilans", (_req, res) => {
  res.json(listBilans());
});

api.get("/bilans/:id", (req, res) => {
  const detail = readBilan(req.params.id);
  if (!detail) return res.status(404).json({ error: "bilan not found" });
  res.json(detail);
});

// Opening a file is a side-effecting action: it must be a POST with a JSON body
// (forces a CORS preflight, which a cross-site no-cors request can't satisfy)
// and the Origin, when present, must be loopback. This stops any visited web
// page from making the local machine `open` an arbitrary file. The path itself
// is intentionally unconfined — this opens project source files (from
// ide_opened_file tags), which live outside ~/.claude.
function isLoopbackOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // curl / same-origin navigations send none
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

api.post("/open", express.json(), (req, res) => {
  if (!isLoopbackOrigin(req.get("origin"))) {
    return res.status(403).json({ error: "cross-origin requests are not allowed" });
  }
  const filePath = String(req.body?.path || "").trim();
  if (!filePath) return res.status(400).json({ error: "missing path" });
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) return res.status(404).json({ error: "file not found" });
  const opener = process.platform === "darwin" ? "open" : "xdg-open";
  execFile(opener, [abs], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ ok: true });
  });
});

/** Stream one file, return the first matching line as an excerpt, or null. */
async function searchFile(filePath: string, needle: string): Promise<string | null> {
  try {
    const stream = fs.createReadStream(filePath, { encoding: "utf8" });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const line of rl) {
        const at = line.toLowerCase().indexOf(needle);
        if (at >= 0) {
          const startAt = Math.max(0, at - 60);
          return line.slice(startAt, at + needle.length + 80).replace(/\s+/g, " ");
        }
      }
    } finally {
      rl.close();
      stream.close();
    }
  } catch {
    /* skip unreadable */
  }
  return null;
}

api.get("/search", async (req, res) => {
  const t0 = Date.now();
  const q = String(req.query.q || "").trim();
  if (q.length < 3) return res.json([]);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));

  const index = await getIndex(); // also ensures FTS index is populated
  const metaById = new Map<string, SessionMeta>(index.map((s) => [s.id, s]));

  let out: SearchHit[];
  try {
    // Rows are per-message (rank-ordered); keep one hit per session, preferring
    // a live-thread match over one buried in an abandoned fork.
    const results = searchDocs(q, limit * 5);
    const bySession = new Map<string, (typeof results)[number]>();
    for (const r of results) {
      const prev = bySession.get(r.sessionId);
      if (!prev || (prev.fork !== null && r.fork === null)) bySession.set(r.sessionId, r);
    }
    out = [...bySession.values()]
      .slice(0, limit)
      .map((r) => {
        const meta = metaById.get(r.sessionId);
        if (!meta) return null;
        return {
          sessionId: r.sessionId,
          projectId: r.projectId,
          projectLabel: meta.projectLabel,
          excerpt: r.excerpt,
          uuid: r.uuid || null,
          fork: r.fork,
          index: r.idx,
        } satisfies SearchHit;
      })
      .filter((h): h is SearchHit => h !== null);
  } catch (e) {
    console.warn("[search] FTS failed, falling back to line scan:", e);
    out = await legacySearch(index, q.toLowerCase(), limit);
  }

  if (PERF) console.log(`[perf] /search "${q}": ${out.length} hits in ${Date.now() - t0}ms`);
  res.json(out);
});

/** Fallback line-scan search (used if FTS fails). */
async function legacySearch(index: SessionMeta[], needle: string, limit: number): Promise<SearchHit[]> {
  const hits: { i: number; hit: SearchHit }[] = [];
  let cursor = 0;
  let done = false;
  const CONCURRENCY = 8;

  async function worker() {
    while (!done) {
      const i = cursor++;
      if (i >= index.length || hits.length >= limit) { done = true; break; }
      const s = index[i];
      const found = await searchFile(sessionFilePath(s.projectId, s.id), needle);
      if (found) {
        // Line scan has no message resolution: no uuid/fork/index deep link.
        hits.push({ i, hit: { sessionId: s.id, projectId: s.projectId, projectLabel: s.projectLabel, excerpt: found, uuid: null, fork: null, index: 0 } });
        if (hits.length >= limit) done = true;
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return hits.sort((a, b) => a.i - b.i).slice(0, limit).map((h) => h.hit);
}
