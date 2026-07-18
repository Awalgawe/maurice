import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// node:sqlite is not yet in Vite's known-builtins list (module.builtinModules
// doesn't include 'sqlite'). createRequire bypasses Vite's static resolver.
const _require = createRequire(import.meta.url);
type SqliteModule = typeof import("node:sqlite");
const { DatabaseSync } = _require("node:sqlite") as SqliteModule;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, "..", "..", ".cache");
const SEARCH_VERSION = 2; // 2: one doc per message (uuid, fork, idx) for fork-aware deep links

let searchDbPath = path.join(CACHE_DIR, "search.db");
let db: InstanceType<typeof DatabaseSync> | null = null;
let disabled = false;

// Test-only: force a batch op to throw so the rebuild's rollback/retry path can
// be exercised (a real COMMIT failure — disk full, corruption — is hard to induce).
let failpoint: "upsert" | "commit" | null = null;
export function _setFailpointForTesting(op: "upsert" | "commit" | null): void {
  failpoint = op;
}

// Word-frequency dictionary built lazily from the indexed corpus.
// Invalidated after any write; rebuilt on first lookup.
let dict: Map<string, number> | null = null;

// The dictionary holds the whole normalized vocabulary in memory and is rebuilt
// by scanning every `body` after each write. Two bounds keep that finite:
//  - above MAX_DICT_DOCS the scan is too costly to repeat, so spell-correction is
//    disabled (empty dict → search still works, just no fuzzy suggestions);
//  - MAX_DICT_WORDS caps the distinct vocabulary held (new words past the cap are
//    dropped; existing ones keep counting).
const DEFAULT_MAX_DICT_DOCS = 50_000;
const DEFAULT_MAX_DICT_WORDS = 100_000;
let maxDictDocs = DEFAULT_MAX_DICT_DOCS;
let maxDictWords = DEFAULT_MAX_DICT_WORDS;

function invalidateDict(): void {
  dict = null;
}

function getDict(): Map<string, number> {
  if (dict) return dict;
  dict = new Map();
  if (!db || disabled) return dict;
  const count = (db.prepare("SELECT COUNT(*) AS n FROM docs").get() as { n: number }).n;
  if (count > maxDictDocs) return dict; // corpus too large: correction disabled
  const rows = db.prepare("SELECT body FROM docs").all() as { body: string }[];
  for (const { body } of rows) {
    for (const w of body.split(/[^a-z0-9]+/)) {
      if (w.length < 3 || w.length > 24) continue;
      if (!dict.has(w) && dict.size >= maxDictWords) continue; // cap distinct vocab
      dict.set(w, (dict.get(w) || 0) + 1);
    }
  }
  return dict;
}

/** Override the dictionary bounds — for testing only. */
export function _setDictLimitsForTesting(docs: number, words: number): void {
  maxDictDocs = docs;
  maxDictWords = words;
  dict = null;
}

// NFD decompose + strip combining diacritics + lowercase so é/e both map to the same trigrams.
function normalize(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// Normalized query tokens (length >= 3), longest first.
function queryTokens(query: string): string[] {
  return normalize(query)
    .trim()
    .split(/\s+/)
    .filter((t) => t.length >= 3)
    .sort((a, b) => b.length - a.length);
}

// The token plus its adjacent-transposition variants ("mauirce" → includes
// "maurice"). N-gram windows can't absorb a swapped pair — it breaks every
// window crossing it — so we un-swap on the query side instead.
function swapVariants(token: string): string[] {
  const out = [token];
  for (let i = 0; i < token.length - 1; i++) {
    if (token[i] === token[i + 1]) continue;
    out.push(token.slice(0, i) + token[i + 1] + token[i] + token.slice(i + 2));
  }
  return out;
}

function extractSnippet(body: string, tokens: string[], contextLen = 80): string {
  const positions = tokens
    .map((t) => ({ term: t, idx: body.indexOf(t) }))
    .filter((p) => p.idx >= 0);
  if (!positions.length) return body.slice(0, 160) + (body.length > 160 ? "…" : "");

  // Anchor = term whose ±contextLen window captures the most other terms.
  // Tie-break: prefer the longest term.
  let anchor = positions[0];
  let best = 0;
  for (const p of positions) {
    const winStart = p.idx - contextLen;
    const winEnd = p.idx + p.term.length + contextLen;
    const count = positions.filter((q) => q.idx >= winStart && q.idx + q.term.length <= winEnd).length;
    if (count > best || (count === best && p.term.length > anchor.term.length)) {
      best = count;
      anchor = p;
    }
  }

  const s = Math.max(0, anchor.idx - contextLen);
  const e = Math.min(body.length, anchor.idx + anchor.term.length + contextLen);
  const chunk = body.slice(s, e);

  // Collect all match ranges within chunk (relative to chunk start).
  const ranges: [number, number][] = [];
  for (const term of tokens) {
    let i = 0;
    while ((i = chunk.indexOf(term, i)) >= 0) {
      ranges.push([i, i + term.length]);
      i += term.length;
    }
  }

  // Sort and merge overlapping ranges.
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [start, end] of ranges) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) {
      last[1] = Math.max(last[1], end);
    } else {
      merged.push([start, end]);
    }
  }

  // Apply markers right-to-left to preserve offsets.
  let marked = chunk;
  for (let k = merged.length - 1; k >= 0; k--) {
    const [start, end] = merged[k];
    marked = marked.slice(0, start) + "\x01" + marked.slice(start, end) + "\x02" + marked.slice(end);
  }

  return (s > 0 ? "…" : "") + marked + (e < body.length ? "…" : "");
}

/**
 * Optimal String Alignment distance (handles substitution, insertion,
 * deletion, adjacent transposition — each costs 1), capped at max.
 * Returns max+1 immediately if the distance exceeds max (early exit).
 */
export function boundedEditDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const m = a.length, n = b.length;
  // Rolling three rows: prev2 = dp[i-2], prev1 = dp[i-1], curr = dp[i]
  let prev2: number[] = new Array(n + 1).fill(0);
  let prev1: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  let curr: number[] = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    let rowMin = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev1[j] + 1,       // deletion
        curr[j - 1] + 1,    // insertion
        prev1[j - 1] + cost // substitution
      );
      // OSA transposition: a[i-2..i-1] swapped vs b[j-2..j-1]
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        curr[j] = Math.min(curr[j], prev2[j - 2] + 1);
      }
      rowMin = Math.min(rowMin, curr[j]);
    }
    if (rowMin > max) return max + 1;
    const tmp = prev2; prev2 = prev1; prev1 = curr; curr = tmp;
  }
  return prev1[n];
}

/**
 * Returns dictionary words within edit distance 1 (words 3-5 chars) or 2
 * (words 6+) of token, ranked by corpus frequency, capped at maxCandidates.
 * ES fuzziness:AUTO semantics.
 */
export function corrections(token: string, maxCandidates = 3): string[] {
  const maxDist = token.length >= 6 ? 2 : 1;
  const cands: { word: string; freq: number }[] = [];
  for (const [word, freq] of getDict()) {
    if (word === token) continue;
    if (boundedEditDistance(token, word, maxDist) <= maxDist) cands.push({ word, freq });
  }
  return cands
    .sort((a, b) => b.freq - a.freq)
    .slice(0, maxCandidates)
    .map((c) => c.word);
}

export function trigrams(token: string): string[] {
  const t = normalize(token);
  const result: string[] = [];
  for (let i = 0; i <= t.length - 3; i++) result.push(t.slice(i, i + 3));
  return result;
}

export function escapeFtsToken(t: string): string {
  return '"' + t.replace(/"/g, '""') + '"';
}

/**
 * Build a FTS5 MATCH expression using overlapping WINDOW_LEN-char phrase queries.
 * With the trigram tokenizer, a double-quoted term like "mauri" is a phrase →
 * FTS5 requires the trigrams dep,epl,plo… to appear CONSECUTIVELY = true substring
 * match. This prevents false positives from scattered trigrams:
 *   AND of individual trigrams: "uri" AND "ric" AND "ice" matches a doc where
 *   "security" has uri, "metric" has ric, "service" has ice — all in different words.
 *   Phrase "urice" requires the exact 5-char sequence to appear in the doc ✓.
 *
 * Typo tolerance: "kubrnetes" shares windows "rnete"/"netes" with "kubernetes" ✓.
 * Short words (< WINDOW_LEN): treated as a single exact phrase.
 */
const WINDOW_LEN = 5;

export function buildMatchExpr(query: string): string | null {
  const tokens = queryTokens(query);
  if (!tokens.length) return null;
  const groups: string[] = [];
  for (const token of tokens) {
    const corrs = corrections(token);
    if (token.length < WINDOW_LEN) {
      // Short word (3-4 chars): exact phrase + dictionary corrections.
      const alts = [token, ...corrs].map(escapeFtsToken);
      groups.push(alts.length === 1 ? alts[0] : "(" + alts.join(" OR ") + ")");
    } else {
      // Longer word: n-gram windows (token + transposition variants) + corrections
      // as exact phrases (they're real corpus words — no windowing needed).
      const phrases = new Set<string>();
      for (const variant of swapVariants(token)) {
        for (let i = 0; i <= variant.length - WINDOW_LEN; i++) {
          phrases.add(variant.slice(i, i + WINDOW_LEN));
        }
      }
      for (const corr of corrs) phrases.add(corr);
      groups.push("(" + [...phrases].map(escapeFtsToken).join(" OR ") + ")");
    }
  }
  return groups.length ? groups.join(" AND ") : null;
}

function initDb(dbPath: string): { fresh: boolean } {
  fs.mkdirSync(path.dirname(dbPath === ":memory:" ? CACHE_DIR : dbPath), { recursive: true });
  const conn = new DatabaseSync(dbPath);
  conn.exec("CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT)");

  let fresh = false;
  let vRow: { v: string } | undefined;
  try {
    vRow = conn.prepare("SELECT v FROM meta WHERE k = 'version'").get() as { v: string } | undefined;
  } catch {
    vRow = undefined;
  }

  if (vRow?.v !== String(SEARCH_VERSION)) {
    conn.exec("DROP TABLE IF EXISTS docs");
    conn.exec(
      "CREATE VIRTUAL TABLE docs USING fts5(body, session_id UNINDEXED, project_id UNINDEXED, uuid UNINDEXED, fork UNINDEXED, idx UNINDEXED, tokenize='trigram')",
    );
    // The version is stamped by commitIndexVersion() only after the caller
    // finishes the full rebuild — a crash/restart mid-rebuild (tsx watch…)
    // must retrigger the rebuild, not leave a silently truncated index.
    console.log("[search] index created (FTS5 trigram, diacritics normalized)");
    fresh = true;
  }

  db = conn;
  return { fresh };
}

export function initSearchIndex(): { fresh: boolean } {
  if (disabled) return { fresh: false };
  if (db) return { fresh: false };
  try {
    return initDb(searchDbPath);
  } catch (e) {
    console.warn("[search] init failed, search degraded:", e);
    disabled = true;
    return { fresh: false };
  }
}

/**
 * Stamp the schema version. Called inside the rebuild batch (before COMMIT) so
 * the version lands atomically with the docs — never on its own. Throws on
 * failure so the caller aborts and rolls back the whole rebuild.
 */
export function commitIndexVersion(): void {
  if (!db || disabled) return;
  db.prepare("INSERT OR REPLACE INTO meta(k, v) VALUES (?, ?)").run("version", String(SEARCH_VERSION));
}

export interface SearchDoc {
  uuid: string;
  body: string;
  fork: string | null; // branch owning the message (null = live thread)
  idx: number; // position within the message's own served view
}

/** Replace a session's documents: one row per text-bearing message. */
export function upsertDocs(sessionId: string, projectId: string, docs: SearchDoc[]): void {
  if (!db || disabled) return;
  if (failpoint === "upsert") throw new Error("[search][test] injected upsert failure");
  db.prepare("DELETE FROM docs WHERE session_id = ?").run(sessionId);
  const ins = db.prepare("INSERT INTO docs(body, session_id, project_id, uuid, fork, idx) VALUES (?, ?, ?, ?, ?, ?)");
  for (const d of docs) {
    ins.run(normalize(d.body), sessionId, projectId, d.uuid, d.fork ?? "", String(d.idx));
  }
  invalidateDict();
}

export function pruneDocs(validSessionIds: Set<string>): void {
  if (!db || disabled) return;
  const existing = db.prepare("SELECT DISTINCT session_id FROM docs").all() as { session_id: string }[];
  const del = db.prepare("DELETE FROM docs WHERE session_id = ?");
  for (const { session_id } of existing) {
    if (!validSessionIds.has(session_id)) del.run(session_id);
  }
  invalidateDict();
}

/**
 * Open the rebuild transaction. Throws if a BEGIN fails (a transaction is
 * already open) — with getIndex() coalesced this shouldn't happen, and swallowing
 * it would run the upserts outside the batch and risk a cross-rebuild COMMIT.
 */
export function beginBatch(): void {
  if (!db || disabled) return;
  db.exec("BEGIN");
}

/**
 * Commit the rebuild transaction. Throws on failure so the caller rolls back and
 * the rebuild is retried next call — a partial index must never be committed nor
 * the cache stamped as up-to-date.
 */
export function endBatch(): void {
  if (!db || disabled) return;
  if (failpoint === "commit") throw new Error("[search][test] injected commit failure");
  db.exec("COMMIT");
}

/** Best-effort rollback of an aborted rebuild transaction (error path only). */
export function rollbackBatch(): void {
  if (!db || disabled) return;
  try {
    db.exec("ROLLBACK");
  } catch {
    /* nothing open to roll back */
  }
}

export function searchDocs(
  query: string,
  limit: number,
): { sessionId: string; projectId: string; excerpt: string; uuid: string; fork: string | null; idx: number }[] {
  if (!db || disabled) return [];
  const expr = buildMatchExpr(query);
  if (!expr) return [];
  // Expand tokens: transposition variants + dictionary corrections, so the
  // snippet highlights the form actually present in the document.
  const base = queryTokens(query);
  const tokens = [...new Set([
    ...base.flatMap(swapVariants),
    ...base.flatMap((t) => corrections(t)),
  ])].sort((a, b) => b.length - a.length);
  const rows = db
    .prepare("SELECT session_id, project_id, body, uuid, fork, idx FROM docs WHERE docs MATCH ? ORDER BY rank LIMIT ?")
    .all(expr, limit) as { session_id: string; project_id: string; body: string; uuid: string; fork: string; idx: string }[];
  return rows.map((r) => ({
    sessionId: r.session_id,
    projectId: r.project_id,
    excerpt: extractSnippet(r.body, tokens),
    uuid: r.uuid,
    fork: r.fork === "" ? null : r.fork,
    idx: Number(r.idx) || 0,
  }));
}

/** Reset module state — for testing only. */
export function _resetForTesting(dbPath: string = ":memory:"): void {
  if (db) {
    try {
      db.close();
    } catch {}
  }
  db = null;
  disabled = false;
  failpoint = null;
  dict = null;
  maxDictDocs = DEFAULT_MAX_DICT_DOCS;
  maxDictWords = DEFAULT_MAX_DICT_WORDS;
  searchDbPath = dbPath;
}
