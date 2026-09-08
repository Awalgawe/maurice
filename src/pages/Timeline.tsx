import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { PeerEdge, PeerMessageLocation, SessionMeta } from "../types";
import { colorForModel, dominantModel, modelLabel } from "../format";
import { useFmt } from "../hooks/useFmt";
import { useT } from "../hooks/useT";
import { useSessions } from "../hooks/useSessions";
import { usePeers } from "../hooks/usePeers";
import { messageLink } from "../lib/messageLink";
import { ErrorState } from "../components/ui/ErrorState";

type Pivot = "ticket" | "branch" | "project";

interface Lane {
  key: string;
  label: string;
  sublabel?: string;
  sessions: SessionMeta[];
  cost: number;
  lastTs: number; // most recent end (or start) — lanes sort newest-first
}

const DAY = 86_400_000;
/** Height of one session row inside an expanded lane. Defined here, not in CSS:
 *  the connector overlay computes its own y from it, so a single number keeps
 *  the arrows on the rows they point at. */
const SESSION_ROW_H = 22;

interface EdgeMark {
  eventId: string;
  dir: "out" | "in";
  x: number;
  y: number;
  ts: string | null;
  href: string | null;
}

/**
 * Place one exchange inside an expanded lane.
 *
 * A **full** connector is drawn only when both ends sit in this lane — the only
 * case where a straight line joins the two rows it actually concerns. Otherwise
 * the visible end gets a **half** connector: a named, clickable marker that
 * links to the other end. Lanes are sorted independently, so a line leaving one
 * would cross rows it has nothing to do with.
 *
 * Returns null when neither end can be placed (no timestamp, or outside the
 * visible window).
 */
function renderEdge(
  e: PeerEdge,
  laneSessionIds: Set<string>,
  rowY: Map<string, number>,
  pctAt: (ts: string | null) => number | null,
): { kind: "full" | "half"; x1: number; y1: number; x2: number; y2: number; marks: EdgeMark[] } | null {
  const place = (loc: PeerMessageLocation, dir: "out" | "in"): EdgeMark | null => {
    if (!laneSessionIds.has(loc.sessionId)) return null;
    const x = pctAt(loc.timestamp);
    const y = rowY.get(loc.sessionId);
    if (x === null || y === undefined) return null;
    return { eventId: loc.eventId, dir, x, y, ts: loc.timestamp, href: null };
  };
  const from = place(e.from, "out");
  const to = place(e.to, "in");
  if (from && to) {
    // Each end links to the OTHER end's message, never to its own anchor.
    from.href = messageLink(e.to.sessionId, e.to);
    to.href = messageLink(e.from.sessionId, e.from);
    return { kind: "full", x1: from.x, y1: from.y, x2: to.x, y2: to.y, marks: [from, to] };
  }
  const here = from ?? to;
  if (!here) return null;
  const other = from ? e.to : e.from;
  here.href = messageLink(other.sessionId, other);
  return { kind: "half", x1: here.x, y1: here.y, x2: here.x, y2: here.y, marks: [here] };
}
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export default function Timeline() {
  const t = useT();
  const { fmtCost, fmtDate, fmtDay } = useFmt();
  const { sessions, status, error, reload } = useSessions();
  const { graph: peers } = usePeers();
  const [pivot, setPivot] = useState<Pivot>("ticket");
  const [range, setRange] = useState<number | null>(null); // window in days; null = all
  // Lanes expanded into one row per session — the only view where a connector
  // can point at a specific session rather than at a whole lane.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const { lanes, t0, span, ticks, legend, excluded, now } = useMemo(() => {
    const now = Date.now();
    const placeable = sessions.filter((s) => s.start); // need a start to position a bar
    const excluded = sessions.length - placeable.length;

    // Full data span (active sessions extend to "now").
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of placeable) {
      const a = new Date(s.start as string).getTime();
      const b = s.end ? new Date(s.end).getTime() : now;
      if (a < lo) lo = a;
      if (b > hi) hi = b;
    }
    if (!isFinite(lo)) { lo = now; hi = now; }

    // Range presets anchor the window to the most recent activity (hi).
    const t0 = range == null ? lo : hi - range * DAY;
    const span = range == null ? Math.max(hi - lo, DAY) : range * DAY;

    // Keep only sessions overlapping the visible window.
    const visible = placeable.filter((s) => {
      const a = new Date(s.start as string).getTime();
      const b = s.end ? new Date(s.end).getTime() : now;
      return a <= t0 + span && b >= t0;
    });

    // Lanes — same grouping keys as the Workflow pivot.
    const map = new Map<string, Lane>();
    const add = (key: string, label: string, s: SessionMeta, sublabel?: string) => {
      let l = map.get(key);
      if (!l) { l = { key, label, sublabel, sessions: [], cost: 0, lastTs: 0 }; map.set(key, l); }
      l.sessions.push(s);
      l.cost += s.estCostUSD;
      const end = s.end ? new Date(s.end).getTime() : new Date(s.start as string).getTime();
      if (end > l.lastTs) l.lastTs = end;
    };
    for (const s of visible) {
      if (pivot === "ticket") add(s.ticket || "(aucun)", s.ticket || t("timeline_no_ticket"), s);
      else if (pivot === "project") add(s.projectId, s.projectLabel, s);
      else if (s.branches.length === 0) add(`${s.projectId}::(aucune)`, t("timeline_no_branch"), s, s.projectLabel);
      else for (const b of s.branches) add(`${s.projectId}::${b}`, b, s, s.projectLabel);
    }
    const lanes = [...map.values()].sort((a, b) => b.lastTs - a.lastTs);

    // Date ticks — pick a day step so ~8-12 ticks fit the span.
    const spanDays = span / DAY;
    const step = [1, 2, 3, 7, 14, 30, 60, 90].find((s) => spanDays / s <= 12) ?? 180;
    const ticks: { pct: number; label: string }[] = [];
    const first = new Date(t0);
    first.setHours(0, 0, 0, 0);
    for (let d = first.getTime(); d <= t0 + span; d += step * DAY) {
      if (d < t0) continue;
      ticks.push({ pct: ((d - t0) / span) * 100, label: fmtDay(ymd(new Date(d))) });
    }

    // Legend — models that actually color a bar.
    const models = new Set<string>();
    for (const s of visible) { const m = dominantModel(s); if (m) models.add(m); }
    const legend = [...models].sort().map((m) => ({ model: m, color: colorForModel(m), label: modelLabel(m) }));

    return { lanes, t0, span, ticks, legend, excluded, now };
  }, [sessions, pivot, range, t, fmtDay]);

  // Edges touching a lane, deduped by (lane, edge.key): a session that appears
  // in several branch lanes would otherwise carry the same exchange twice.
  const edgesByLane = useMemo(() => {
    const out = new Map<string, PeerEdge[]>();
    if (!peers) return out;
    for (const lane of lanes) {
      const ids = new Set(lane.sessions.map((s) => s.id));
      const seen = new Set<string>();
      const list: PeerEdge[] = [];
      for (const e of peers.edges) {
        if (!ids.has(e.from.sessionId) && !ids.has(e.to.sessionId)) continue;
        if (seen.has(e.key)) continue;
        seen.add(e.key);
        list.push(e);
      }
      if (list.length) out.set(lane.key, list);
    }
    return out;
  }, [peers, lanes]);

  const pctAt = (ts: string | null): number | null => {
    if (!ts) return null;
    const v = ((new Date(ts).getTime() - t0) / span) * 100;
    return v >= 0 && v <= 100 ? v : null;
  };

  const pivotLabels: Record<Pivot, string> = {
    ticket: t("timeline_group_ticket"),
    branch: t("timeline_group_branch"),
    project: t("timeline_group_project"),
  };

  if (status === "error") return <ErrorState message={error} onRetry={reload} />;
  if (status === "loading") return <div className="center">{t("sessions_loading")}</div>;

  return (
    <div>
      <div className="controls">
        <span className="muted">{t("timeline_group_label")}</span>
        {(["ticket", "branch", "project"] as Pivot[]).map((p) => (
          <button key={p} className={pivot === p ? "active" : ""} onClick={() => setPivot(p)}>
            {pivotLabels[p]}
          </button>
        ))}
        <span className="muted">{t("timeline_range_label")}</span>
        {([null, 30, 14, 7] as (number | null)[]).map((r) => (
          <button key={r ?? "all"} className={range === r ? "active" : ""} onClick={() => setRange(r)}>
            {r == null ? t("timeline_range_all") : `${r}${t("timeline_range_day_suffix")}`}
          </button>
        ))}
        <span className="hint">{lanes.length} {t("workflow_groups")}</span>
        {legend.length > 0 && (
          <span className="tl-legend">
            {legend.map((l) => (
              <span key={l.model} className="leg">
                <span className="dash-donut-swatch" style={{ background: l.color }} />
                {l.label}
              </span>
            ))}
          </span>
        )}
      </div>

      {excluded > 0 && (
        <p className="muted" style={{ fontSize: 12 }}>{excluded} {t("timeline_excluded_no_time")}</p>
      )}

      {lanes.length === 0 ? (
        <p className="center">{t("timeline_empty")}</p>
      ) : (
        <div className="timeline">
          <div className="tl-row tl-axis-row">
            <div className="tl-corner" />
            <div className="tl-axis">
              {ticks.map((tk, i) => (
                <span key={i} className="tl-tick" style={{ left: `${tk.pct}%` }}>{tk.label}</span>
              ))}
            </div>
          </div>
          <div className="tl-lanes">
            {lanes.map((lane) => {
              const laneEdges = edgesByLane.get(lane.key) ?? [];
              const isOpen = expanded.has(lane.key);
              const laneSessionIds = new Set(lane.sessions.map((s) => s.id));
              // Only the sessions that actually take part in an exchange of this
              // lane get a row: a lane can hold hundreds of sessions, and a row
              // carrying no connector is noise the reader has to scroll past.
              const involved = new Set<string>();
              for (const e of laneEdges) {
                if (laneSessionIds.has(e.from.sessionId)) involved.add(e.from.sessionId);
                if (laneSessionIds.has(e.to.sessionId)) involved.add(e.to.sessionId);
              }
              // Stable row order inside the lane, and the y a connector points at.
              const rows = lane.sessions
                .filter((s) => involved.has(s.id))
                .sort((a, b) => new Date(a.start as string).getTime() - new Date(b.start as string).getTime());
              const rowY = new Map(rows.map((s, i) => [s.id, i * SESSION_ROW_H + SESSION_ROW_H / 2]));
              return (
              <div key={lane.key} className="tl-row tl-lane">
                <div className="tl-lane-head">
                  <div className="tl-lane-name" title={lane.label}>
                    {laneEdges.length > 0 && (
                      <button
                        type="button"
                        className={"tl-lane-toggle" + (isOpen ? " open" : "")}
                        title={isOpen ? t("timeline_lane_collapse") : t("timeline_lane_expand")}
                        aria-expanded={isOpen}
                        onClick={() =>
                          setExpanded((prev) => {
                            const next = new Set(prev);
                            if (next.has(lane.key)) next.delete(lane.key);
                            else next.add(lane.key);
                            return next;
                          })
                        }
                      >
                        ⇄
                      </button>
                    )}
                    {lane.label}
                  </div>
                  <div className="tl-lane-meta">
                    {lane.sublabel ? lane.sublabel + " · " : ""}
                    {lane.sessions.length} · {fmtCost(lane.cost)}
                    {laneEdges.length > 0 && ` · ${laneEdges.length} ${t("timeline_peer_edges")}`}
                  </div>
                </div>
                <div className="tl-track">
                  {ticks.map((tk, i) => (
                    <i key={i} className="tl-grid" style={{ left: `${tk.pct}%` }} />
                  ))}
                  {lane.sessions.map((s) => {
                    const start = new Date(s.start as string).getTime();
                    const end = s.end ? new Date(s.end).getTime() : now;
                    // Clip to the visible window [t0, t0+span].
                    const left = Math.max(0, ((start - t0) / span) * 100);
                    const right = Math.min(100, ((end - t0) / span) * 100);
                    const width = Math.max(0.2, right - left);
                    const model = dominantModel(s);
                    const title =
                      `${s.projectLabel}${s.ticket ? " · " + s.ticket : ""}\n` +
                      `${fmtDate(s.start)} → ${s.end ? fmtDate(s.end) : "…"}\n` +
                      `${modelLabel(model)} · ${fmtCost(s.estCostUSD)}`;
                    return (
                      <Link
                        key={s.id}
                        to={`/sessions/${s.id}`}
                        className={"tl-bar" + (s.end ? "" : " active")}
                        title={title}
                        style={{
                          left: `${left}%`,
                          width: `${width}%`,
                          background: colorForModel(model),
                        }}
                      />
                    );
                  })}
                </div>
                {isOpen && (
                  <div className="tl-sessions">
                    <div className="tl-session-names">
                      {rows.map((s) => (
                        <div key={s.id} className="tl-session-row" style={{ height: SESSION_ROW_H }}>
                          <Link to={`/sessions/${s.id}`} className="tl-session-name" title={s.aiTitle || s.projectPath}>
                            {s.aiTitle || s.projectLabel}
                          </Link>
                        </div>
                      ))}
                    </div>
                    <div className="tl-session-track" style={{ height: rows.length * SESSION_ROW_H }}>
                    {ticks.map((tk, i) => (
                      <i key={i} className="tl-grid" style={{ left: `${tk.pct}%` }} />
                    ))}
                    {rows.map((s, i) => {
                      // The session's own span, so a marker reads against the
                      // life of the session it sits on rather than floating.
                      const start = new Date(s.start as string).getTime();
                      const end = s.end ? new Date(s.end).getTime() : now;
                      const left = Math.max(0, ((start - t0) / span) * 100);
                      const right = Math.min(100, ((end - t0) / span) * 100);
                      return (
                        <i
                          key={s.id}
                          className="tl-session-bar"
                          style={{
                            left: `${left}%`,
                            width: `${Math.max(0.2, right - left)}%`,
                            top: i * SESSION_ROW_H + SESSION_ROW_H / 2 - 2,
                            background: colorForModel(dominantModel(s)),
                          }}
                        />
                      );
                    })}
                    <svg className="tl-connectors" aria-hidden="true">
                      {laneEdges.map((e) => {
                        const ends = renderEdge(e, laneSessionIds, rowY, pctAt);
                        return ends && ends.kind === "full" ? (
                          <line
                            key={e.key}
                            className="tl-conn"
                            x1={`${ends.x1}%`}
                            y1={ends.y1}
                            x2={`${ends.x2}%`}
                            y2={ends.y2}
                          />
                        ) : null;
                      })}
                    </svg>
                    {laneEdges.map((e) => {
                      const ends = renderEdge(e, laneSessionIds, rowY, pctAt);
                      if (!ends) return null;
                      // A full connector still gets its two endpoints as dots;
                      // a half connector gets one clickable, named marker — the
                      // other end lives in a lane sorted independently, so an
                      // arrow across rows would cross unrelated lines.
                      return ends.marks.map((mk) => {
                        const glyph = mk.dir === "out" ? "→" : "←";
                        const cls = "tl-peer-mark" + (ends.kind === "full" ? " full" : " half");
                        const style = { left: `${mk.x}%`, top: mk.y };
                        const title = `${glyph} ${e.summary ?? ""}\n${
                          ends.kind === "full" ? t("peer_connector_same_lane") : t("peer_connector_cross_lane")
                        }\n${fmtDate(mk.ts)}`;
                        const key = `${e.key}:${mk.eventId}`;
                        // messageLink returns null when it cannot place the
                        // counterpart: no link at all, rather than one that
                        // lands on the wrong message (same rule as PeerMeta).
                        return mk.href ? (
                          <Link key={key} to={mk.href} className={cls} style={style} title={title}>
                            {glyph}
                          </Link>
                        ) : (
                          <span key={key} className={cls + " dead"} style={style} title={title}>
                            {glyph}
                          </span>
                        );
                      });
                    })}
                    </div>
                  </div>
                )}
              </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
