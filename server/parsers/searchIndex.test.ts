import { describe, it, expect, beforeEach } from "vitest";
import {
  trigrams,
  escapeFtsToken,
  buildMatchExpr,
  boundedEditDistance,
  corrections,
  initSearchIndex,
  upsertDocs,
  searchDocs,
  pruneDocs,
  beginBatch,
  endBatch,
  _resetForTesting,
} from "./searchIndex.ts";

/** Single-message session shorthand (most cases only need one doc). */
function upsertDoc(sessionId: string, projectId: string, body: string): void {
  upsertDocs(sessionId, projectId, [{ uuid: `u-${sessionId}`, body, fork: null, idx: 0 }]);
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

describe("trigrams", () => {
  it("generates sliding 3-char windows", () => {
    expect(trigrams("abcde")).toEqual(["abc", "bcd", "cde"]);
  });

  it("returns empty for tokens shorter than 3", () => {
    expect(trigrams("ab")).toEqual([]);
    expect(trigrams("")).toEqual([]);
  });

  it("normalizes diacritics: é → e", () => {
    expect(trigrams("déploiement")).toEqual(trigrams("deploiement"));
  });

  it("lowercases input", () => {
    expect(trigrams("ABC")).toEqual(trigrams("abc"));
  });
});

describe("boundedEditDistance", () => {
  it("substitution: toot → tool = 1", () => {
    expect(boundedEditDistance("toot", "tool", 1)).toBe(1);
  });

  it("transposition: mauirce → maurice = 1", () => {
    expect(boundedEditDistance("mauirce", "maurice", 1)).toBe(1);
  });

  it("totally different words exceed max", () => {
    expect(boundedEditDistance("abc", "xyz", 1)).toBeGreaterThan(1);
  });

  it("length pre-filter: skips if length diff > max", () => {
    expect(boundedEditDistance("ab", "abcdef", 2)).toBeGreaterThan(2);
  });

  it("equal strings = 0", () => {
    expect(boundedEditDistance("kubernetes", "kubernetes", 2)).toBe(0);
  });

  it("one insertion: kubrnetes → kubernetes = 1", () => {
    expect(boundedEditDistance("kubrnetes", "kubernetes", 1)).toBe(1);
  });
});

describe("escapeFtsToken", () => {
  it("wraps in double quotes", () => {
    expect(escapeFtsToken("kub")).toBe('"kub"');
  });

  it("escapes internal double quotes by doubling", () => {
    expect(escapeFtsToken('a"b')).toBe('"a""b"');
  });
});

describe("buildMatchExpr", () => {
  it("returns null for empty query", () => {
    expect(buildMatchExpr("")).toBeNull();
    expect(buildMatchExpr("  ")).toBeNull();
  });

  it("returns null if all tokens are shorter than 3 chars", () => {
    expect(buildMatchExpr("ci mr")).toBeNull();
  });

  it("builds phrase windows: 5-char substrings OR-ed, words AND-ed", () => {
    // "kubernetes" (10 chars) → 5-char phrase windows; "dep" (3 chars) → single phrase
    const expr = buildMatchExpr("kubernetes dep");
    expect(expr).not.toBeNull();
    // Must contain 5-char substrings for kubernetes and exact phrase for dep
    expect(expr).toContain('"kuber"');
    expect(expr).toContain('"dep"');
    // Words are AND-ed at the top level
    expect(expr).toMatch(/\) AND /);
    // kubernetes phrases are OR-ed
    expect(expr).toContain('"kuber" OR "ubern"');
  });

  it("normalizes diacritics so accented and unaccented queries are equivalent", () => {
    expect(buildMatchExpr("déploiement")).toBe(buildMatchExpr("deploiement"));
  });

  it("ignores tokens shorter than 3 chars within a multi-word query", () => {
    const expr = buildMatchExpr("ci kubernetes");
    // Only kubernetes contributes
    expect(expr).not.toBeNull();
    expect(expr).not.toContain('"ci"');
    expect(expr).toContain('"kuber"');
    // Single word group at top level — no inter-word AND
    expect(expr).not.toContain(") AND (");
  });
});

// ── Integration (in-memory DB) ────────────────────────────────────────────────

beforeEach(() => {
  _resetForTesting(":memory:");
  initSearchIndex();
});

describe("searchDocs", () => {
  it("finds an exact match", () => {
    upsertDoc("sess1", "proj1", "deploying kubernetes in production");
    const hits = searchDocs("kubernetes", 10);
    expect(hits.map((h) => h.sessionId)).toContain("sess1");
  });

  it("does not return unrelated sessions with coincidental individual trigrams", () => {
    upsertDoc("target", "proj1", "the app is named Maurice");
    upsertDoc("noise", "proj1", "service metrics and practices for pricing");
    // 'noise' has individual trigrams of 'maurice' (ice, ric) but no window of
    // 3 consecutive ones → windowed matching must exclude it.
    const hits = searchDocs("maurice", 10);
    const ids = hits.map((h) => h.sessionId);
    expect(ids).toContain("target");
    expect(ids).not.toContain("noise");
  });

  it("tolerates an adjacent transposition (mauirce → maurice)", () => {
    upsertDoc("sess1", "proj1", "the app is named Maurice");
    const hits = searchDocs("mauirce", 10);
    expect(hits.map((h) => h.sessionId)).toContain("sess1");
    // and the snippet highlights the form found in the doc
    expect(hits[0].excerpt).toContain("\x01maurice\x02");
  });

  it("substitution correction: toot → tool (short word, dict-based)", () => {
    upsertDoc("sess1", "proj1", "using the right tool for the job");
    const hits = searchDocs("toot", 10);
    expect(hits.map((h) => h.sessionId)).toContain("sess1");
    // snippet highlights the actual word found in the doc
    expect(hits[0].excerpt).toContain("\x01tool\x02");
  });

  it("substitution correction: kubarnetes → kubernetes (long word, distance 1)", () => {
    upsertDoc("sess1", "proj1", "deploying kubernetes in production");
    const hits = searchDocs("kubarnetes", 10);
    expect(hits.map((h) => h.sessionId)).toContain("sess1");
  });

  it("correction prefers most frequent word in corpus", () => {
    upsertDoc("sess1", "proj1", "tool tool tool");
    upsertDoc("sess2", "proj1", "toll toll");
    // both "tool" and "toll" are at distance 1 from "toot"; "tool" is more frequent
    const corrs = corrections("toot", 1);
    expect(corrs[0]).toBe("tool");
  });

  it("correction is invalidated after new upsert", () => {
    // corpus initially has no word near "zort"
    upsertDoc("sess1", "proj1", "unrelated content here");
    expect(corrections("zort")).toEqual([]);
    // now add a doc with "sort" (distance 1 from "zort")
    upsertDoc("sess2", "proj1", "sort the results");
    expect(corrections("zort")).toContain("sort");
  });

  it("no false positives: corpus without close words returns 0 results for correction", () => {
    upsertDoc("noise", "proj1", "service metrics pricing analytics");
    // "toot" → no word in corpus is close to it → no match
    const hits = searchDocs("toot", 10);
    expect(hits.map((h) => h.sessionId)).not.toContain("noise");
  });

  it("tolerates a typo (kubrnetes → kubernetes)", () => {
    upsertDoc("sess1", "proj1", "deploying kubernetes in production");
    // A typo drops a few trigrams but a window of 3 consecutive ones still matches.
    const hits = searchDocs("kubrnetes", 10);
    expect(hits.map((h) => h.sessionId)).toContain("sess1");
  });

  it("matches partial words (deplo → deploiement)", () => {
    upsertDoc("sess1", "proj1", "déploiement de l'application");
    const hits = searchDocs("deplo", 10);
    expect(hits.map((h) => h.sessionId)).toContain("sess1");
  });

  it("tolerates missing diacritics (deploiement → déploiement)", () => {
    upsertDoc("sess1", "proj1", "déploiement kubernetes");
    const hits = searchDocs("deploiement", 10);
    expect(hits.map((h) => h.sessionId)).toContain("sess1");
  });

  it("multi-word query: session with both words ranks first", () => {
    upsertDoc("both", "proj1", "kubernetes deployment with docker containers on production");
    upsertDoc("kube-only", "proj1", "kubernetes cluster scaling pods autoscaling");
    const hits = searchDocs("kubernetes docker", 10);
    const ids = hits.map((h) => h.sessionId);
    // "both" has trigrams from both query words → must appear and rank first
    expect(ids).toContain("both");
    expect(ids.indexOf("both")).toBe(0);
  });

  it("ranks more relevant sessions higher", () => {
    upsertDoc("sess1", "proj1", "kubernetes deployment on kubernetes cluster");
    upsertDoc("sess2", "proj1", "brief mention of kubernets");
    const hits = searchDocs("kubernetes", 10);
    const ids = hits.map((h) => h.sessionId);
    // sess1 has more kubernetes trigrams → should rank first
    expect(ids[0]).toBe("sess1");
  });

  it("returns empty array for query with no usable tokens (<3 chars)", () => {
    upsertDoc("sess1", "proj1", "ci pipeline run");
    const hits = searchDocs("ci", 10);
    expect(hits).toEqual([]);
  });

  it("respects the limit", () => {
    for (let i = 0; i < 5; i++) upsertDoc(`sess${i}`, "proj", `kubernetes deployment session ${i}`);
    const hits = searchDocs("kubernetes", 3);
    expect(hits.length).toBeLessThanOrEqual(3);
  });

  it("upsert replaces existing doc", () => {
    upsertDoc("sess1", "proj1", "kubernetes deployment");
    upsertDoc("sess1", "proj1", "react frontend development"); // overwrite
    const k8s = searchDocs("kubernetes", 10);
    const react = searchDocs("react", 10);
    expect(k8s.map((h) => h.sessionId)).not.toContain("sess1");
    expect(react.map((h) => h.sessionId)).toContain("sess1");
  });

  it("pruneDocs removes vanished sessions", () => {
    upsertDoc("sess1", "proj1", "kubernetes deployment");
    upsertDoc("sess2", "proj1", "kubernetes cluster");
    beginBatch();
    pruneDocs(new Set(["sess1"])); // sess2 is gone
    endBatch();
    const hits = searchDocs("kubernetes", 10);
    expect(hits.map((h) => h.sessionId)).toContain("sess1");
    expect(hits.map((h) => h.sessionId)).not.toContain("sess2");
  });

  it("stores per-message docs and returns uuid/fork/idx on hits", () => {
    upsertDocs("sess1", "proj1", [
      { uuid: "m1", body: "the live thread talks about kubernetes", fork: null, idx: 3 },
      { uuid: "m2", body: "an abandoned attempt mentioning terraform", fork: "f1", idx: 5 },
    ]);
    const live = searchDocs("kubernetes", 10);
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ sessionId: "sess1", uuid: "m1", fork: null, idx: 3 });
    const forked = searchDocs("terraform", 10);
    expect(forked).toHaveLength(1);
    expect(forked[0]).toMatchObject({ sessionId: "sess1", uuid: "m2", fork: "f1", idx: 5 });
  });

  it("returns one row per matching message of the same session", () => {
    upsertDocs("sess1", "proj1", [
      { uuid: "m1", body: "kubernetes on the live thread", fork: null, idx: 0 },
      { uuid: "m2", body: "kubernetes again on a fork", fork: "f1", idx: 2 },
    ]);
    const hits = searchDocs("kubernetes", 10);
    expect(hits).toHaveLength(2);
    expect(new Set(hits.map((h) => h.uuid))).toEqual(new Set(["m1", "m2"]));
  });
});
