import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { SessionMeta } from "../types";
import { colorForModel, dominantModel, modelLabel } from "../format";
import { useFmt } from "../hooks/useFmt";
import { useT } from "../hooks/useT";
import { useSessions } from "../hooks/useSessions";
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
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export default function Timeline() {
  const t = useT();
  const { fmtCost, fmtDate, fmtDay } = useFmt();
  const { sessions, status, error, reload } = useSessions();
  const [pivot, setPivot] = useState<Pivot>("ticket");
  const [range, setRange] = useState<number | null>(null); // window in days; null = all

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
            {lanes.map((lane) => (
              <div key={lane.key} className="tl-row tl-lane">
                <div className="tl-lane-head">
                  <div className="tl-lane-name" title={lane.label}>{lane.label}</div>
                  <div className="tl-lane-meta">
                    {lane.sublabel ? lane.sublabel + " · " : ""}
                    {lane.sessions.length} · {fmtCost(lane.cost)}
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
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
