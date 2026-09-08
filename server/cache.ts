import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listSessionFiles, subagentsFingerprint } from "./claudeDir.ts";
import { buildMetaAndDocs, reaggregateSubagentMeta } from "./parsers/sessions.ts";
import { initSearchIndex, commitIndexVersion, upsertDocs, pruneDocs, beginBatch, endBatch, rollbackBatch } from "./parsers/searchIndex.ts";
import type { SessionMeta } from "../src/types.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let CACHE_DIR = path.join(__dirname, "..", ".cache");
let CACHE_FILE = path.join(CACHE_DIR, "index.json");
const CACHE_VERSION = 23; // 23: cross-session peer events (peerEvents)

/** Redirect the metadata cache to a scratch dir so tests never touch the real
 *  project-local .cache/ (a dev server may be reading/writing it concurrently). */
export function _setCacheDirForTesting(dir: string): void {
  CACHE_DIR = dir;
  CACHE_FILE = path.join(dir, "index.json");
}

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

// A rebuild in progress. Concurrent getIndex() callers share it: the search
// index uses one module-global SQLite connection and a single BEGIN/COMMIT
// batch, so overlapping rebuilds would interleave transactions (a second BEGIN
// fails, and one caller could COMMIT another's open batch). Coalescing here
// guarantees a single rebuild owns the transaction; the next call after it
// settles rebuilds afresh, so new/changed files are still picked up.
let inFlight: Promise<SessionMeta[]> | null = null;

/**
 * Build (or refresh) the session index. Each file is re-parsed only if its
 * (size, mtime) changed since last run; otherwise the cached meta is reused.
 * Concurrent calls are coalesced onto a single rebuild (see `inFlight`).
 */
export function getIndex(): Promise<SessionMeta[]> {
  if (inFlight) return inFlight;
  inFlight = buildIndex().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function buildIndex(): Promise<SessionMeta[]> {
  const cache = load();
  const { fresh } = initSearchIndex();
  const files = listSessionFiles();
  const next: CacheShape = { version: CACHE_VERSION, entries: {} };
  const metas: SessionMeta[] = [];
  let reparsed = 0;

  // One owned transaction for the whole rebuild: any failure (upsert, prune,
  // version stamp, COMMIT) aborts it, rolls back, and rethrows so nothing partial
  // is stamped or cached. getIndex() clears inFlight in its finally, so the next
  // call retries the rebuild from the last good on-disk cache.
  beginBatch();
  try {
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
      upsertDocs(f.id, f.projectId, searchDocs);
      next.entries[key] = { size: f.size, mtimeMs: f.mtimeMs, subagentsFp, meta };
      metas.push(meta);
      reparsed++;
    }
    pruneDocs(new Set(files.map((f) => f.id)));
    // Stamp the schema version inside the batch so it commits atomically with the
    // docs; a rebuild that fails to COMMIT leaves it unstamped.
    commitIndexVersion();
    endBatch();
  } catch (e) {
    rollbackBatch();
    console.error("[search] index rebuild failed, rolled back (will retry):", e);
    throw e;
  }

  // Reached only after a successful COMMIT: safe to publish the metadata snapshot.
  save(next);
  metas.sort((a, b) => (b.end || "").localeCompare(a.end || ""));
  if (reparsed) console.log(`Index: ${metas.length} sessions (${reparsed} reparsed)`);
  return metas;
}
