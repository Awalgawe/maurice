import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listSessionFiles, subagentsFingerprint } from "./claudeDir.ts";
import { buildMetaAndDocs, reaggregateSubagentMeta } from "./parsers/sessions.ts";
import { initSearchIndex, commitIndexVersion, upsertDocs, pruneDocs, beginBatch, endBatch } from "./parsers/searchIndex.ts";
import type { SessionMeta } from "../src/types.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, "..", ".cache");
const CACHE_FILE = path.join(CACHE_DIR, "index.json");
const CACHE_VERSION = 13; // 13: per-session subagent cost/token aggregate

interface CacheEntry {
  size: number;
  mtimeMs: number;
  subagentsFp: string; // fingerprint of the subagents dir (invalidates the aggregate)
  meta: SessionMeta;
}
interface CacheShape {
  version: number;
  entries: Record<string, CacheEntry>; // key = projectId/id
}

function load(): CacheShape {
  try {
    const data = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")) as CacheShape;
    if (data.version === CACHE_VERSION) return data;
  } catch {
    /* no cache yet */
  }
  return { version: CACHE_VERSION, entries: {} };
}

function save(cache: CacheShape): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache));
  } catch (e) {
    console.warn("Could not persist index cache:", e);
  }
}

/**
 * Build (or refresh) the session index. Each file is re-parsed only if its
 * (size, mtime) changed since last run; otherwise the cached meta is reused.
 */
export async function getIndex(): Promise<SessionMeta[]> {
  const cache = load();
  const { fresh } = initSearchIndex();
  const files = listSessionFiles();
  const next: CacheShape = { version: CACHE_VERSION, entries: {} };
  const metas: SessionMeta[] = [];
  let reparsed = 0;

  beginBatch();
  for (const f of files) {
    const key = `${f.projectId}/${f.id}`;
    const prev = cache.entries[key];
    const subagentsFp = subagentsFingerprint(f.projectId, f.id);
    if (!fresh && prev && prev.size === f.size && prev.mtimeMs === f.mtimeMs) {
      if (prev.subagentsFp === subagentsFp) {
        next.entries[key] = prev;
        metas.push(prev.meta);
        continue;
      }
      // Session file unchanged but a subagent transcript changed: re-aggregate
      // only the subagent part, reuse the rest of the cached meta. Search docs
      // come from the session file (unchanged), so the FTS index is left as-is.
      const meta = await reaggregateSubagentMeta(prev.meta, f.projectId, f.id);
      next.entries[key] = { size: f.size, mtimeMs: f.mtimeMs, subagentsFp, meta };
      metas.push(meta);
      reparsed++;
      continue;
    }
    const { meta, searchDocs } = await buildMetaAndDocs(f);
    try { upsertDocs(f.id, f.projectId, searchDocs); } catch (e) { console.warn("[search] upsert failed:", e); }
    next.entries[key] = { size: f.size, mtimeMs: f.mtimeMs, subagentsFp, meta };
    metas.push(meta);
    reparsed++;
  }
  try {
    pruneDocs(new Set(files.map((f) => f.id)));
    endBatch();
    // Stamp only after a complete rebuild landed; a partial one must rerun.
    if (fresh) commitIndexVersion();
  } catch (e) {
    console.warn("[search] prune/commit failed:", e);
  }

  save(next);
  metas.sort((a, b) => (b.end || "").localeCompare(a.end || ""));
  if (reparsed) console.log(`Index: ${metas.length} sessions (${reparsed} reparsed)`);
  return metas;
}
