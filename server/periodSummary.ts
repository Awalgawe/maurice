import { windowSession } from "../src/lib/windowedAgg.ts";
import type {
  PeriodFriction,
  PeriodProject,
  PeriodSession,
  PeriodSummary,
  SessionMeta,
  TokenTotals,
} from "../src/types.ts";

export interface PeriodQuery {
  from?: string | null; // inclusive "YYYY-MM-DD"
  to?: string | null; // inclusive
  project?: string | null; // substring over project id / label / path
}

const emptyTokens = (): TokenTotals => ({ input: 0, output: 0, cacheRead: 0, cacheCreate: 0 });

const emptyFriction = (): PeriodFriction => ({
  interruptionCount: 0,
  errorCount: 0,
  apiRetryCount: 0,
  apiErrorMessageCount: 0,
  denialCounts: {},
  promptCounts: {},
  toolErrors: {},
});

function addMap(dst: Record<string, number>, src: Record<string, number>): void {
  for (const [k, v] of Object.entries(src)) dst[k] = (dst[k] || 0) + v;
}

function addFriction(dst: PeriodFriction, src: PeriodFriction): void {
  dst.interruptionCount += src.interruptionCount;
  dst.errorCount += src.errorCount;
  dst.apiRetryCount += src.apiRetryCount;
  dst.apiErrorMessageCount += src.apiErrorMessageCount;
  addMap(dst.denialCounts, src.denialCounts);
  addMap(dst.promptCounts, src.promptCounts);
  addMap(dst.toolErrors, src.toolErrors);
}

/** Weight used only to rank sessions for follow-up reading, never reported as a metric. */
function frictionScore(f: PeriodFriction): number {
  const sum = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0);
  return (
    f.interruptionCount +
    f.errorCount +
    f.apiRetryCount +
    f.apiErrorMessageCount +
    sum(f.denialCounts) +
    sum(f.toolErrors)
  );
}

function matchesProject(s: SessionMeta, needle: string): boolean {
  return (
    s.projectId.toLowerCase().includes(needle) ||
    s.projectLabel.toLowerCase().includes(needle) ||
    s.projectPath.toLowerCase().includes(needle)
  );
}

/**
 * Aggregate the session index over a closed day range, reusing the Dashboard's
 * per-day windowing (`windowSession`) so a session straddling a period bound
 * contributes only the days inside it — rather than counting whole sessions
 * whose last activity merely lands in the window.
 *
 * Day-decomposable signals land in `friction`; session-level scalars that carry
 * no timestamp land in `undated`, attributed by session start date. Sessions
 * cached before the per-day breakdown existed are counted in
 * `sessionsMissingByDay` instead of being silently dropped.
 */
export function computePeriodSummary(index: SessionMeta[], query: PeriodQuery = {}): PeriodSummary {
  const from = query.from || null;
  const to = query.to || null;
  const needle = (query.project || "").trim().toLowerCase();

  const friction = emptyFriction();
  const tokens = emptyTokens();
  const projects = new Map<string, PeriodProject>();
  const sessions: PeriodSession[] = [];
  const activeDays = new Set<string>();
  const modes = new Set<string>();

  let estCostUSD = 0;
  let sessionCount = 0;
  let sessionsMissingByDay = 0;
  let permissionModeChanges = 0;
  let compactCount = 0;
  let hookErrorCount = 0;

  for (const s of index) {
    if (needle && !matchesProject(s, needle)) continue;

    const w = windowSession(s.byDay, from, to);
    const days = Object.keys(s.byDay || {}).filter((d) => (!from || d >= from) && (!to || d <= to));
    // No day of this session falls in the window — but tell apart "outside the
    // period" from "this session predates byDay and can't be windowed at all".
    if (days.length === 0) {
      if (!s.byDay && inRangeByStart(s, from, to)) sessionsMissingByDay++;
      continue;
    }

    sessionCount++;
    for (const d of days) activeDays.add(d);

    const sFriction: PeriodFriction = {
      interruptionCount: w.interruptionCount,
      errorCount: w.errorCount,
      apiRetryCount: w.apiRetryCount,
      apiErrorMessageCount: w.apiErrorMessageCount,
      denialCounts: w.denialCounts,
      promptCounts: w.promptCounts,
      toolErrors: w.toolErrors,
    };
    addFriction(friction, sFriction);

    tokens.input += w.tokens.input;
    tokens.output += w.tokens.output;
    tokens.cacheRead += w.tokens.cacheRead;
    tokens.cacheCreate += w.tokens.cacheCreate;
    estCostUSD += w.cost;

    // Undated scalars: whole-session counts, attributed by start date.
    permissionModeChanges += s.permissionModeChanges || 0;
    compactCount += s.compactCount || 0;
    hookErrorCount += s.hookErrorCount || 0;
    for (const m of s.permissionModes || []) modes.add(m);

    const p =
      projects.get(s.projectId) ||
      ({
        projectId: s.projectId,
        projectLabel: s.projectLabel,
        sessions: 0,
        estCostUSD: 0,
        friction: emptyFriction(),
      } satisfies PeriodProject);
    p.sessions++;
    p.estCostUSD += w.cost;
    addFriction(p.friction, sFriction);
    projects.set(s.projectId, p);

    sessions.push({
      id: s.id,
      projectLabel: s.projectLabel,
      start: s.start,
      end: s.end,
      estCostUSD: w.cost,
      frictionScore: frictionScore(sFriction),
    });
  }

  sessions.sort((a, b) => b.frictionScore - a.frictionScore || (a.start || "").localeCompare(b.start || ""));

  return {
    from,
    to,
    sessionCount,
    activeDays: activeDays.size,
    estCostUSD,
    tokens,
    friction,
    undated: {
      permissionModeChanges,
      compactCount,
      hookErrorCount,
      permissionModes: [...modes].sort(),
    },
    byProject: [...projects.values()].sort((a, b) => b.estCostUSD - a.estCostUSD),
    sessions,
    sessionsMissingByDay,
  };
}

/** Fallback membership test for sessions with no per-day breakdown. */
function inRangeByStart(s: SessionMeta, from: string | null, to: string | null): boolean {
  const day = (s.start || "").slice(0, 10);
  if (!day) return false;
  return (!from || day >= from) && (!to || day <= to);
}
