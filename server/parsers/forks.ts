import type { ForkInfo } from "../../src/types.ts";

/**
 * Conversation-fork analysis over the parentUuid tree of a session JSONL.
 *
 * A rewind (Esc Esc) never deletes lines: the abandoned messages stay in the
 * file and the live thread is the parentUuid chain walked up from the last
 * line. Two fork shapes exist between renderable (user/assistant) lines and
 * MUST be told apart:
 *  - parallel tool calls: sibling assistant lines share the parent's
 *    requestId / message.id — same API turn, part of the live thread;
 *  - rewind / prompt retry: a second human prompt forked off the same parent —
 *    the earlier subtree is a dead branch.
 *
 * A "view" is defined by a tip line: its ancestor chain, plus same-turn
 * assistant siblings (requestId / message.id), plus the tool_results answering
 * any tool_use of those assistant lines. The active view's tip is the last
 * renderable line of the file; each abandoned subtree gets a view tipped at
 * its own last line.
 */

const RENDERABLE = new Set(["user", "assistant"]);

interface LineRec {
  uuid: string;
  parent: string | null;
  renderable: boolean;
  assistant: boolean;
  timestamp: string | null;
  requestId: string | null;
  messageId: string | null;
  toolUseIds: string[]; // tool_use ids emitted (assistant lines)
  toolResultIds: string[]; // tool_use ids answered (user tool_result lines)
  preview: string | null; // human prompt excerpt (user lines with string content)
}

export interface ForkAnalysis {
  /** Rewind-abandoned branches, ordered by where they diverge in the file. */
  forks: ForkInfo[];
  /** Fork ref owning a renderable line, or null when it is on the live thread. */
  forkOf(uuid: string | null): string | null;
  /** Refs of the branches diverging at this line (it is their fork point). */
  forksAt(uuid: string | null): string[];
  /**
   * Renderable uuids of a view, or null for an unknown ref. The active view
   * (ref null) is everything not owned by a fork; a fork view is the shared
   * prefix plus its own subtree.
   */
  viewMembers(ref: string | null): Set<string> | null;
}

export interface ForkCollector {
  add(obj: unknown): void;
  finish(): ForkAnalysis;
}

const PREVIEW_LEN = 120;

function normParent(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

/** Streaming collector: feed every JSONL line, then finish() once at EOF. */
export function createForkCollector(): ForkCollector {
  const lines: LineRec[] = [];
  const byUuid = new Map<string, LineRec>();

  function add(obj: unknown): void {
    const o = obj as Record<string, any>;
    if (!o || typeof o.uuid !== "string" || byUuid.has(o.uuid)) return;
    const msg = o.message;
    const content = msg?.content;
    const toolUseIds: string[] = [];
    const toolResultIds: string[] = [];
    let preview: string | null = null;
    if (Array.isArray(content)) {
      for (const c of content) {
        if (c?.type === "tool_use" && typeof c.id === "string") toolUseIds.push(c.id);
        else if (c?.type === "tool_result" && typeof c.tool_use_id === "string") toolResultIds.push(c.tool_use_id);
      }
    } else if (typeof content === "string" && o.type === "user") {
      preview = content.slice(0, PREVIEW_LEN);
    }
    const rec: LineRec = {
      uuid: o.uuid,
      parent: normParent(o.parentUuid),
      renderable: RENDERABLE.has(o.type),
      assistant: o.type === "assistant",
      timestamp: typeof o.timestamp === "string" ? o.timestamp : null,
      requestId: o.type === "assistant" && typeof o.requestId === "string" ? o.requestId : null,
      messageId: o.type === "assistant" && typeof msg?.id === "string" ? msg.id : null,
      toolUseIds,
      toolResultIds,
      preview,
    };
    lines.push(rec);
    byUuid.set(rec.uuid, rec);
  }

  /** Ancestor chain of tip + same-turn assistant siblings + their tool_results. */
  function computeView(tip: LineRec): Set<string> {
    const view = new Set<string>();
    // A0: ancestor chain (through non-renderable lines too), cycle-guarded.
    for (let cur: LineRec | undefined = tip; cur && !view.has(cur.uuid); cur = cur.parent ? byUuid.get(cur.parent) : undefined) {
      view.add(cur.uuid);
    }
    // A1: assistant lines of the same API turn as a chain line.
    const reqIds = new Set<string>();
    const msgIds = new Set<string>();
    for (const uuid of view) {
      const r = byUuid.get(uuid);
      if (r?.requestId) reqIds.add(r.requestId);
      if (r?.messageId) msgIds.add(r.messageId);
    }
    for (const r of lines) {
      if (!r.assistant || view.has(r.uuid)) continue;
      if ((r.requestId && reqIds.has(r.requestId)) || (r.messageId && msgIds.has(r.messageId))) view.add(r.uuid);
    }
    // A2: tool_results answering any tool_use of an in-view assistant line.
    const toolIds = new Set<string>();
    for (const uuid of view) {
      const r = byUuid.get(uuid);
      if (r) for (const id of r.toolUseIds) toolIds.add(id);
    }
    for (const r of lines) {
      if (view.has(r.uuid) || r.toolResultIds.length === 0) continue;
      if (r.toolResultIds.some((id) => toolIds.has(id))) view.add(r.uuid);
    }
    return view;
  }

  function finish(): ForkAnalysis {
    // Owner of each renderable line: null = live thread, "fN" = fork.
    const owner = new Map<string, string | null>();
    const forkViews = new Map<string, Set<string>>();
    const forks: ForkInfo[] = [];

    const renderables = lines.filter((r) => r.renderable);
    const activeTip = renderables[renderables.length - 1];
    if (activeTip) {
      const view = computeView(activeTip);
      for (const r of renderables) if (view.has(r.uuid)) owner.set(r.uuid, null);
    }

    // Remaining renderables either diverged from an owned line (rewind fork)
    // or live in a disconnected segment (compaction) — the latter stay on the
    // live thread. Process in file order so refs follow chronology; nested
    // rewinds resolve in later iterations.
    let guard = lines.length + 1;
    for (;;) {
      if (guard-- <= 0) break; // safety net: malformed trees must not hang the parser
      const pending = renderables.find((r) => !owner.has(r.uuid));
      if (!pending) break;

      // Walk up to the nearest owned renderable line (the fork point).
      let forkPoint: LineRec | null = null;
      let subtreeRoot: LineRec = pending;
      const seen = new Set<string>([pending.uuid]);
      for (let cur = pending.parent ? byUuid.get(pending.parent) : undefined; cur; cur = cur.parent ? byUuid.get(cur.parent) : undefined) {
        if (seen.has(cur.uuid)) break;
        seen.add(cur.uuid);
        if (cur.renderable && owner.has(cur.uuid)) { forkPoint = cur; break; }
        subtreeRoot = cur;
      }

      if (!forkPoint) {
        // Disconnected segment (e.g. post-compaction root): live thread.
        // Claim the whole segment at once via its own view.
        const segTipCandidates = renderables.filter((r) => !owner.has(r.uuid) && reachesSameRoot(r, subtreeRoot));
        const segTip = segTipCandidates[segTipCandidates.length - 1] ?? pending;
        const view = computeView(segTip);
        for (const r of renderables) if (!owner.has(r.uuid) && view.has(r.uuid)) owner.set(r.uuid, null);
        if (!owner.has(pending.uuid)) owner.set(pending.uuid, null); // never loop on the same line
        continue;
      }

      // Rewind fork: view tipped at the subtree's last renderable line.
      const inSubtree = (r: LineRec): boolean => {
        const walked = new Set<string>();
        for (let cur: LineRec | undefined = r; cur && !walked.has(cur.uuid); cur = cur.parent ? byUuid.get(cur.parent) : undefined) {
          walked.add(cur.uuid);
          if (cur.uuid === subtreeRoot.uuid) return true;
          if (cur.renderable && owner.has(cur.uuid)) return false;
        }
        return false;
      };
      const subtree = renderables.filter((r) => !owner.has(r.uuid) && inSubtree(r));
      const tip = subtree[subtree.length - 1] ?? pending;
      const ref = `f${forks.length + 1}`;
      const view = computeView(tip);
      const members: string[] = [];
      for (const r of renderables) {
        if (!owner.has(r.uuid) && view.has(r.uuid)) {
          owner.set(r.uuid, ref);
          members.push(r.uuid);
        }
      }
      if (!owner.has(pending.uuid)) owner.set(pending.uuid, ref); // progress guarantee
      forkViews.set(ref, view);
      const firstHuman = members.map((u) => byUuid.get(u)!).find((r) => r.preview !== null);
      forks.push({
        ref,
        forkPointUuid: forkPoint.uuid,
        divergedAt: subtreeRoot.timestamp ?? byUuid.get(members[0] ?? pending.uuid)?.timestamp ?? null,
        messageCount: members.length || 1,
        preview: firstHuman?.preview ?? null,
        forkPointIndex: 0, // filled by the position pass below
        forkPointIndexLive: 0,
      });
    }

    // Position of each fork point within its two views (fork's own + live),
    // so the UI can land on the divergence line when switching branches.
    // For nested forks the point is not live; the live index still counts the
    // live turns before it — the page lands right, the anchor just no-ops.
    for (const f of forks) {
      const view = forkViews.get(f.ref)!;
      let iF = 0;
      let iL = 0;
      for (const r of renderables) {
        if (r.uuid === f.forkPointUuid) break;
        if (view.has(r.uuid)) iF++;
        if (owner.get(r.uuid) === null) iL++;
      }
      f.forkPointIndex = iF;
      f.forkPointIndexLive = iL;
    }

    function reachesSameRoot(r: LineRec, root: LineRec): boolean {
      const walked = new Set<string>();
      for (let cur: LineRec | undefined = r; cur && !walked.has(cur.uuid); cur = cur.parent ? byUuid.get(cur.parent) : undefined) {
        walked.add(cur.uuid);
        if (cur.uuid === root.uuid) return true;
        if (cur.renderable && owner.has(cur.uuid)) return false;
      }
      return false;
    }

    const byForkPoint = new Map<string, string[]>();
    for (const f of forks) {
      const arr = byForkPoint.get(f.forkPointUuid) ?? [];
      arr.push(f.ref);
      byForkPoint.set(f.forkPointUuid, arr);
    }

    return {
      forks,
      forkOf: (uuid) => (uuid ? (owner.get(uuid) ?? null) : null),
      forksAt: (uuid) => (uuid ? (byForkPoint.get(uuid) ?? []) : []),
      viewMembers: (ref) => {
        if (ref === null) {
          const out = new Set<string>();
          for (const [uuid, o] of owner) if (o === null) out.add(uuid);
          return out;
        }
        const view = forkViews.get(ref);
        if (!view) return null;
        // A fork view = its full ancestor prefix + same-turn closure, whoever
        // owns the prefix lines (a nested fork's prefix crosses its parent fork).
        const out = new Set<string>();
        for (const r of lines) if (r.renderable && view.has(r.uuid)) out.add(r.uuid);
        return out;
      },
    };
  }

  return { add, finish };
}
