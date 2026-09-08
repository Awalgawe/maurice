import type { LineageRef, SessionContinuity, SessionMeta } from "../src/types.ts";

/**
 * Cross-file continuation join (see SessionContinuity in src/types.ts).
 *
 * Pure and derived from the index on every call — never persisted, like
 * `computeFacets` and `computePeerGraph`: it relates one transcript to others,
 * so it cannot live under a per-file (size, mtime) cache key.
 *
 * The only evidence used is the recorded API `requestId` sequence, which a fork
 * copy reproduces verbatim. Same first requestId ⇒ same conversation (a
 * requestId identifies one API call, so it cannot be shared by chance). A
 * strict prefix ⇒ a proven continuation. Anything weaker stays `diverged`.
 */

type Relation = "same" | "prefix" | "extends" | "diverged";

/** How `a` relates to `b`: "prefix" = a ⊂ b, "extends" = b ⊂ a. */
function relate(a: string[], b: string[]): Relation {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return "diverged";
  if (a.length === b.length) return "same";
  return a.length < b.length ? "prefix" : "extends";
}

function lineageOf(m: SessionMeta): string | null {
  const ids = m.requestIds;
  return ids && ids.length > 0 ? ids[0] : null;
}

function ref(m: SessionMeta): LineageRef {
  return {
    sessionId: m.id,
    projectId: m.projectId,
    projectLabel: m.projectLabel,
    title: m.aiTitle || null,
    requestCount: m.requestIds?.length ?? 0,
    messageCount: m.messageCount,
    start: m.start,
    end: m.end,
  };
}

/**
 * Every other transcript of `meta`'s conversation, classified by what the
 * requestId sequences prove. Returns null when this file is the only one — or
 * when it recorded no API request at all, which leaves nothing to join on.
 */
export function computeContinuity(index: SessionMeta[], meta: SessionMeta): SessionContinuity | null {
  const lineageId = lineageOf(meta);
  if (!lineageId) return null;
  const own = meta.requestIds!;

  const continuedIn: SessionMeta[] = [];
  const continuedFrom: SessionMeta[] = [];
  const duplicates: SessionMeta[] = [];
  const diverged: SessionMeta[] = [];

  for (const s of index) {
    if (s.id === meta.id || lineageOf(s) !== lineageId) continue;
    switch (relate(own, s.requestIds!)) {
      case "prefix":
        continuedIn.push(s);
        break;
      case "extends":
        continuedFrom.push(s);
        break;
      case "same":
        duplicates.push(s);
        break;
      default:
        diverged.push(s);
    }
  }

  if (!continuedIn.length && !continuedFrom.length && !duplicates.length && !diverged.length) return null;

  const byCount = (dir: 1 | -1) => (a: SessionMeta, b: SessionMeta) =>
    dir * (a.requestIds!.length - b.requestIds!.length) || (a.end || "").localeCompare(b.end || "");
  const byEnd = (a: SessionMeta, b: SessionMeta) => (a.end || "").localeCompare(b.end || "");

  return {
    lineageId,
    continuedIn: continuedIn.sort(byCount(1)).map(ref),
    continuedFrom: continuedFrom.sort(byCount(-1)).map(ref),
    duplicates: duplicates.sort(byEnd).map(ref),
    diverged: diverged.sort(byEnd).map(ref),
  };
}
