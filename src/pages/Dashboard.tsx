import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SessionMeta } from "../types";
import { colorForModel, dominantModel, fmtDurationMs, modelLabel, skillLabel, totalTokens } from "../format";
import { useFmt } from "../hooks/useFmt";
import { useT } from "../hooks/useT";
import { useSessions } from "../hooks/useSessions";
import { windowSession } from "../lib/windowedAgg";
import { useLang } from "../state/LangContext";
import { Chip } from "../components/ui/Chip";
import { Panel } from "../components/ui/Panel";
import { ErrorState } from "../components/ui/ErrorState";

// Donut slice palette — themed categorical tokens (defined per theme in index.css).
const SLICE_COLORS = Array.from({ length: 8 }, (_, i) => `var(--cat-${i + 1})`);

const DAY = 86_400_000;
const RANGE_KEY = "maurice.dashboard.range";

// Local-time YYYY-MM-DD — day bucketing must match the index (parsed in local
// time) and the rest of the UI, not UTC.
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// The four token components, in display order, with their (themed) colors.
const COMPONENTS = [
  { key: "input", labelKey: "dashboard_tok_input", color: "var(--accent)" },
  { key: "output", labelKey: "dashboard_tok_output", color: "var(--accent-2)" },
  { key: "cacheRead", labelKey: "dashboard_tok_cache_read", color: "var(--green)" },
  { key: "cacheCreate", labelKey: "dashboard_tok_cache_create", color: "var(--amber)" },
] as const;

/** Merge record maps: sum numeric values key by key. */
function mergeRecord(acc: Record<string, number>, src: Record<string, number>) {
  for (const [k, v] of Object.entries(src)) acc[k] = (acc[k] || 0) + v;
}

function sortedEntries(r: Record<string, number>, topN?: number) {
  const entries = Object.entries(r).sort((a, b) => b[1] - a[1]);
  return topN ? entries.slice(0, topN) : entries;
}

const fmtDuration = fmtDurationMs;

export default function Dashboard() {
  const t = useT();
  const { lang } = useLang();
  const { fmtCost, fmtTokens, fmtDate, fmtDay, fmtAgo } = useFmt();
  const { sessions, status, error, reload } = useSessions();

  // Period filter, persisted (mirrors ThemeContext/LangContext/EditorContext).
  const [range, setRange] = useState<number | null>(() => {
    const v = localStorage.getItem(RANGE_KEY);
    if (v === null) return 30;
    if (v === "all") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : 30;
  });
  useEffect(() => {
    localStorage.setItem(RANGE_KEY, range == null ? "all" : String(range));
  }, [range]);

  // Window anchored on the most recent activity (like Timeline), not literal now.
  const scoped = useMemo(() => {
    if (range == null) return sessions;
    let hi = -Infinity;
    for (const s of sessions) {
      const ts = s.end || s.start;
      if (ts) { const v = new Date(ts).getTime(); if (v > hi) hi = v; }
    }
    if (!isFinite(hi)) return sessions;
    const cutoff = hi - range * DAY;
    return sessions.filter((s) => {
      const ts = s.end || s.start;
      return ts ? new Date(ts).getTime() >= cutoff : false;
    });
  }, [sessions, range]);

  // Short weekday names, Monday-first, in the active locale (2024-01-01 was a Monday).
  const dayLabels = useMemo(
    () => Array.from({ length: 7 }, (_, i) =>
      new Intl.DateTimeFormat(lang, { weekday: "short" }).format(new Date(2024, 0, 1 + i))),
    [lang],
  );

  const agg = useMemo(() => {
    if (!scoped.length) return null;

    // Lower bound (local day) for the time charts: a session is kept by the
    // range filter on its last activity, but its per-day cost/activity can reach
    // back before the window — clip those days so the X axis stays bounded.
    let cutoffDay: string | null = null;
    if (range != null) {
      let hi = -Infinity;
      for (const s of scoped) {
        const ts = s.end || s.start;
        if (ts) { const v = new Date(ts).getTime(); if (v > hi) hi = v; }
      }
      if (isFinite(hi)) cutoffDay = ymd(new Date(hi - range * DAY));
    }

    let totalCost = 0;
    let totalTok = 0;
    let totalErrors = 0;
    let inTok = 0, outTok = 0, crTok = 0, ccTok = 0;
    const costComp = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 };
    const modelCostAgg: Record<string, number> = {};
    const skillCostAgg: Record<string, number> = {};
    const projectCostAgg: Record<string, number> = {};
    const projectLabelMap: Record<string, string> = {};
    const mcpTally: Record<string, number> = {};
    const toolCallsAgg: Record<string, number> = {};
    const toolErrorsAgg: Record<string, number> = {};
    const dayMap: Record<string, { cost: number; sessions: number }> = {};
    const ctxBuckets = [0, 0, 0, 0]; // 0-25, 25-50, 50-75, 75-100
    const heat: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
    const durations: number[] = []; // wall-clock span per session (median below — robust to left-open outliers)
    const allErrors: { ts: string | null; tool: string; excerpt: string; sessionId: string; projectLabel: string }[] = [];
    // Real active time (turn_duration lines), day-clipped like costByDay; falls
    // back to the session-level total when no per-day breakdown is cached.
    let workMs = 0;
    let turnCount = 0;
    let apiRetryCount = 0;
    let apiErrorMessageCount = 0;
    let interruptionCount = 0;
    const denialCounts: Record<string, number> = {};
    const promptCounts: Record<string, number> = {};
    // Per-session windowed cost/tokens/errors, so error rate and the top-sessions
    // list describe the selected period — not the sessions' full-lifetime totals.
    const perSession: { s: SessionMeta; cost: number; tokens: number; errors: number }[] = [];

    for (const s of scoped) {
      // Decomposable KPIs are summed over the days within the window (byDay), so
      // a session whose last activity merely lands in the window doesn't drag in
      // its pre-window cost/tokens/activity. When byDay is absent (should not
      // happen post-v22 reparse), windowSession returns zeros for that session.
      const w = windowSession(s.byDay, cutoffDay);
      totalCost += w.cost;
      totalTok += totalTokens(w.tokens);
      totalErrors += w.errorCount;
      perSession.push({ s, cost: w.cost, tokens: totalTokens(w.tokens), errors: w.errorCount });
      for (const e of s.errors ?? []) {
        if (cutoffDay && e.ts && ymd(new Date(e.ts)) < cutoffDay) continue;
        allErrors.push({ ...e, sessionId: s.id, projectLabel: s.projectLabel });
      }
      inTok += w.tokens.input; outTok += w.tokens.output;
      crTok += w.tokens.cacheRead; ccTok += w.tokens.cacheCreate;
      costComp.input += w.costByComponent.input; costComp.output += w.costByComponent.output;
      costComp.cacheRead += w.costByComponent.cacheRead; costComp.cacheCreate += w.costByComponent.cacheCreate;
      mergeRecord(modelCostAgg, w.modelCost);
      mergeRecord(skillCostAgg, w.skillCost);
      projectCostAgg[s.projectId] = (projectCostAgg[s.projectId] || 0) + w.cost;
      projectLabelMap[s.projectId] = s.projectLabel;
      // Session-presence per MCP tool (used at least once within the window).
      for (const tool of Object.keys(w.mcpTools)) mcpTally[tool] = (mcpTally[tool] || 0) + 1;
      mergeRecord(toolCallsAgg, w.toolCounts);
      mergeRecord(toolErrorsAgg, w.toolErrors);

      // Context-peak distribution and session duration don't decompose by day —
      // they are session properties, kept over the sessions active in the window.
      const pct = s.peakContextPct;
      if (pct < 25) ctxBuckets[0]++;
      else if (pct < 50) ctxBuckets[1]++;
      else if (pct < 75) ctxBuckets[2]++;
      else ctxBuckets[3]++;

      // Cost: spread across the days the session actually spanned (per-message).
      for (const [day, c] of Object.entries(s.costByDay ?? {})) {
        if (cutoffDay && day < cutoffDay) continue;
        const d = dayMap[day] || { cost: 0, sessions: 0 };
        d.cost += c;
        dayMap[day] = d;
      }
      // Sessions: counted on every day the session was active (≥1 message).
      for (const day of s.activeDays ?? []) {
        if (cutoffDay && day < cutoffDay) continue;
        const d = dayMap[day] || { cost: 0, sessions: 0 };
        d.sessions++;
        dayMap[day] = d;
      }

      // Heatmap: message volume per (day-of-week × hour), local — windowed.
      for (const [slot, count] of Object.entries(w.heat)) {
        const n = Number(slot);
        heat[Math.floor(n / 24)][n % 24] += count;
      }
      if (s.start && s.end) {
        const dur = new Date(s.end).getTime() - new Date(s.start).getTime();
        if (dur > 0) durations.push(dur);
      }

      turnCount += w.turnCount;
      apiRetryCount += w.apiRetryCount;
      apiErrorMessageCount += w.apiErrorMessageCount;
      interruptionCount += w.interruptionCount;
      mergeRecord(denialCounts, w.denialCounts);
      mergeRecord(promptCounts, w.promptCounts);
      workMs += w.turnDurationMs;
    }

    const timeline = Object.entries(dayMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, ...v }));

    const n = scoped.length;
    // Windowed: a session counts as errored only if it errored within the period.
    const errorRate = ((perSession.filter((p) => p.errors > 0).length / n) * 100).toFixed(1);
    // Costliest sessions ranked and displayed on their in-window cost/tokens, so a
    // session mostly spent before the window doesn't outrank one spent within it.
    const topSessions = [...perSession]
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 8);
    const recentErrors = allErrors
      .sort((a, b) => (b.ts ?? "").localeCompare(a.ts ?? ""))
      .slice(0, 5);
    const cacheBase = inTok + crTok + ccTok;
    const cacheHitPct = cacheBase ? (crTok / cacheBase) * 100 : 0;
    const heatMax = Math.max(1, ...heat.flat());
    durations.sort((a, b) => a - b);
    const medianDurationMs = durations.length
      ? durations.length % 2
        ? durations[(durations.length - 1) / 2]
        : (durations[durations.length / 2 - 1] + durations[durations.length / 2]) / 2
      : 0;

    return {
      totalCost, totalTok, totalErrors, sessionCount: n,
      avgCost: totalCost / n, avgTok: totalTok / n,
      medianDurationMs,
      workMs, avgTurnMs: turnCount > 0 ? workMs / turnCount : 0,
      apiRetryCount, apiErrorMessageCount,
      interruptionCount, denialCounts, promptCounts,
      cacheHitPct,
      compVolume: [inTok, outTok, crTok, ccTok],
      compCost: [costComp.input, costComp.output, costComp.cacheRead, costComp.cacheCreate],
      modelCostAgg, skillCostAgg, projectCostAgg, projectLabelMap,
      mcpTally, toolCallsAgg, toolErrorsAgg, timeline, ctxBuckets, errorRate, heat, heatMax, recentErrors,
      topSessions,
    };
  }, [scoped, range]);

  if (status === "error") return <ErrorState message={error} onRetry={reload} />;
  if (status === "loading") return <div className="center">{t("sessions_loading")}</div>;

  const topModels = agg ? sortedEntries(agg.modelCostAgg, 8) : [];
  const topSkills = agg ? sortedEntries(agg.skillCostAgg, 10) : [];
  const topProjects = agg ? sortedEntries(agg.projectCostAgg, 8) : [];
  const topMcp = agg ? sortedEntries(agg.mcpTally, 20) : [];
  const topTools = agg ? sortedEntries(agg.toolCallsAgg, 8) : [];
  const maxToolCalls = topTools[0]?.[1] || 1;
  const maxSkillCost = topSkills[0]?.[1] || 1;
  const maxProjectCost = topProjects[0]?.[1] || 1;
  const topSessions = agg?.topSessions ?? [];

  const ctxData = agg ? [
    { label: "0–25 %", value: agg.ctxBuckets[0], fill: "var(--green)" },
    { label: "25–50 %", value: agg.ctxBuckets[1], fill: "var(--accent)" },
    { label: "50–75 %", value: agg.ctxBuckets[2], fill: "var(--amber)" },
    { label: "75–100 %", value: agg.ctxBuckets[3], fill: "var(--red)" },
  ] : [];

  const tooltipStyle = { background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 };

  // A horizontal stacked bar of the four token components + a legend with values.
  const composition = (values: number[], fmt: (n: number) => string) => {
    const total = values.reduce((a, b) => a + b, 0) || 1;
    return (
      <>
        <div className="dash-stack">
          {COMPONENTS.map((c, i) => values[i] > 0 && (
            <span key={c.key} className="dash-stack-seg"
              style={{ flexBasis: `${(values[i] / total) * 100}%`, background: c.color }}
              title={`${t(c.labelKey)} · ${fmt(values[i])}`} />
          ))}
        </div>
        <div className="dash-comp-legend">
          {COMPONENTS.map((c, i) => (
            <span className="dash-comp-item" key={c.key}>
              <span className="dash-donut-swatch" style={{ background: c.color }} />
              <span className="dash-comp-name">{t(c.labelKey)}</span>
              <span className="dash-comp-val">{fmt(values[i])}</span>
            </span>
          ))}
        </div>
      </>
    );
  };

  const ranges: (number | null)[] = [7, 30, 90, null];

  return (
    <div>
      {/* ── Period filter ── */}
      <div className="controls dash-controls">
        <span className="muted">{t("timeline_range_label")}</span>
        {ranges.map((r) => (
          <button key={r ?? "all"} className={range === r ? "active" : ""} onClick={() => setRange(r)}>
            {r == null ? t("timeline_range_all") : `${r}${t("timeline_range_day_suffix")}`}
          </button>
        ))}
        <span className="hint">{scoped.length} {t("sessions_count")}</span>
      </div>

      {!agg ? (
        <div className="center">{t("dashboard_no_data")}</div>
      ) : (
      <>
      {/* ── KPIs ── */}
      <div className="dash-kpis">
        <div className="kpi">
          <span className="val cost">{fmtCost(agg.totalCost)}</span>
          <span className="lbl">{t("dashboard_kpi_cost")}</span>
        </div>
        <div className="kpi">
          <span className="val">{fmtTokens(agg.totalTok)}</span>
          <span className="lbl">{t("dashboard_kpi_tokens")}</span>
        </div>
        <div className="kpi">
          <span className="val">{agg.sessionCount}</span>
          <span className="lbl">{t("dashboard_kpi_sessions")}</span>
        </div>
        <div className="kpi">
          <span className="val cost">{fmtCost(agg.avgCost)}</span>
          <span className="lbl">{t("dashboard_kpi_cost_per_session")}</span>
        </div>
        <div className="kpi">
          <span className="val">{agg.cacheHitPct.toFixed(0)} %</span>
          <span className="lbl">{t("dashboard_kpi_cache_hit")}</span>
        </div>
        <div className="kpi">
          <span className="val" style={{ color: Number(agg.errorRate) > 20 ? "var(--red)" : "var(--text)" }}>
            {agg.errorRate} %
          </span>
          <span className="lbl">{t("dashboard_health_error_rate")}</span>
        </div>
      </div>

      {/* ── Activité & habitudes ── */}
      <div className="dash-section">
        <h2>{t("dashboard_section_activity")}</h2>
        <div className="dash-grid dash-grid-4">
            <Panel title={t("dashboard_chart_cost")}>
              <div style={{ flex: 1, minHeight: 140, minWidth: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={agg.timeline} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: "var(--muted)", fontSize: 10 }} stroke="var(--border)" height={16}
                    tickFormatter={(v) => fmtDay(String(v))} />
                  <YAxis tick={{ fill: "var(--muted)", fontSize: 11 }} stroke="var(--border)" width={32} />
                  <Tooltip contentStyle={tooltipStyle}
                    labelFormatter={(v) => fmtDay(String(v))}
                    formatter={(v) => [fmtCost(Number(v)), t("dashboard_chart_cost")]} />
                  <Area type="monotone" dataKey="cost" stroke="var(--accent)" fill="color-mix(in srgb, var(--accent) 20%, transparent)" isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
              </div>
            </Panel>
            <Panel title={t("dashboard_chart_sessions")}>
              <div style={{ flex: 1, minHeight: 140, minWidth: 0 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={agg.timeline} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: "var(--muted)", fontSize: 10 }} stroke="var(--border)" height={16}
                    tickFormatter={(v) => fmtDay(String(v))} />
                  <YAxis tick={{ fill: "var(--muted)", fontSize: 11 }} stroke="var(--border)" allowDecimals={false} width={24} />
                  <Tooltip contentStyle={tooltipStyle}
                    labelFormatter={(v) => fmtDay(String(v))}
                    formatter={(v) => [Number(v), t("dashboard_chart_sessions")]} />
                  <Bar dataKey="sessions" fill="var(--accent-2)" isAnimationActive={false} radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              </div>
            </Panel>
          <Panel title={t("dashboard_act_heatmap")}>
            <div className="dash-heatmap">
              <span className="dash-hm-corner" />
              {Array.from({ length: 24 }, (_, h) => (
                <span key={"h" + h} className="dash-hm-hour">{h % 6 === 0 ? `${h}h` : ""}</span>
              ))}
              {agg.heat.map((row, dow) => (
                <Fragment key={dow}>
                  <span className="dash-hm-day">{dayLabels[dow]}</span>
                  {row.map((c, hr) => (
                    <span key={hr} className="dash-hm-cell"
                      title={`${dayLabels[dow]} ${hr}h · ${c} ${t("sessions_count")}`}
                      style={c > 0
                        ? { background: "var(--accent)", opacity: 0.15 + 0.85 * (c / agg.heatMax) }
                        : { background: "var(--panel-2)" }} />
                  ))}
                </Fragment>
              ))}
            </div>
          </Panel>

          <Panel title={t("dashboard_act_averages")}>
            <div className="dash-stat-row">
              <span className="dash-stat-label">{t("dashboard_act_median_duration")}</span>
              <span className="dash-stat-val">{agg.medianDurationMs > 0 ? fmtDuration(agg.medianDurationMs) : "—"}</span>
            </div>
            <div className="dash-stat-row">
              <span className="dash-stat-label">{t("dashboard_kpi_sessions")}</span>
              <span className="dash-stat-val">{agg.sessionCount}</span>
            </div>
            <div className="dash-stat-row">
              <span className="dash-stat-label">{t("dashboard_act_time_spent")}</span>
              <span className="dash-stat-val">{agg.workMs > 0 ? fmtDuration(agg.workMs) : "—"}</span>
            </div>
            <div className="dash-stat-row">
              <span className="dash-stat-label">{t("dashboard_act_avg_turn")}</span>
              <span className="dash-stat-val">{agg.avgTurnMs > 0 ? fmtDuration(agg.avgTurnMs) : "—"}</span>
            </div>
          </Panel>
        </div>
      </div>

      {/* ── Coûts ── */}
      <div className="dash-section">
        <h2>{t("dashboard_section_breakdown")}</h2>
        <div className="dash-grid dash-grid-4">
          {/* Coût par modèle — donut */}
          <Panel title={t("dashboard_panel_model")}>
            {topModels.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={160}>
                  <PieChart>
                    <Pie data={topModels.map(([name, value]) => ({ name, value }))}
                      dataKey="value" cx="50%" cy="50%" innerRadius={40} outerRadius={70}
                      isAnimationActive={false}>
                      {topModels.map(([name], i) => (
                        <Cell key={name} fill={SLICE_COLORS[i % SLICE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} formatter={(v) => [fmtCost(Number(v)), ""]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="dash-donut-legend">
                  {topModels.map(([name, val], i) => (
                    <Link className="dash-donut-row dash-link" key={name}
                      to={`/sessions?model=${encodeURIComponent(name)}`}>
                      <span className="dash-donut-swatch" style={{ background: SLICE_COLORS[i % SLICE_COLORS.length] }} />
                      <span className="dash-donut-name" title={name}>{name.replace(/^claude-/, "")}</span>
                      <span className="dash-donut-val cost">{fmtCost(val)}</span>
                    </Link>
                  ))}
                </div>
              </>
            ) : <div className="muted">{t("dashboard_no_data")}</div>}
          </Panel>

          {/* Top skills */}
          <Panel title={t("dashboard_panel_skill")}>
            {topSkills.map(([key, val]) => {
              const inner = (
                <>
                  <span className="dash-bar-label" title={key}>
                    {key === "(aucun)" ? t("workflow_no_skill") : skillLabel(key)}
                  </span>
                  <div className="dash-bar-track">
                    <div className="dash-bar-fill" style={{ width: `${(val / maxSkillCost) * 100}%` }} />
                  </div>
                  <span className="dash-bar-val cost">{fmtCost(val)}</span>
                </>
              );
              return key === "(aucun)" ? (
                <div className="dash-bar-row" key={key}>{inner}</div>
              ) : (
                <Link className="dash-bar-row dash-link" key={key} to={`/sessions?skill=${encodeURIComponent(key)}`}>{inner}</Link>
              );
            })}
          </Panel>

          {/* Top projets */}
          <Panel title={t("dashboard_panel_project")}>
            {topProjects.map(([id, val]) => (
              <Link className="dash-bar-row dash-link" key={id} to={`/sessions?project=${encodeURIComponent(id)}`}>
                <span className="dash-bar-label" title={agg.projectLabelMap[id]}>
                  {agg.projectLabelMap[id]}
                </span>
                <div className="dash-bar-track">
                  <div className="dash-bar-fill" style={{ width: `${(val / maxProjectCost) * 100}%`, background: "var(--accent-2)" }} />
                </div>
                <span className="dash-bar-val cost">{fmtCost(val)}</span>
              </Link>
            ))}
          </Panel>

          {/* Sessions les plus coûteuses */}
          <Panel title={t("dashboard_panel_top_sessions")}>
            {topSessions.length > 0 ? topSessions.map(({ s, cost, tokens }) => {
              const m = dominantModel(s);
              return (
                <Link
                  className="dash-toplist-row dash-link"
                  key={s.id}
                  to={`/sessions/${s.id}`}
                  title={s.aiTitle ?? s.firstUserPrompt ?? undefined}
                >
                  <span className="dash-toplist-main">
                    <span className="dash-toplist-name" title={s.projectPath}>{s.projectLabel}</span>
                    <span className="dash-toplist-meta">
                      {fmtDate(s.end)}{m ? " · " + modelLabel(m) : ""} · {fmtTokens(tokens)}
                    </span>
                  </span>
                  <span className="dash-toplist-val cost">{fmtCost(cost)}</span>
                </Link>
              );
            }) : <div className="muted">{t("dashboard_no_data")}</div>}
          </Panel>
        </div>
      </div>

      {/* ── Efficacité ── */}
      <div className="dash-section">
        <h2>{t("dashboard_section_efficiency")}</h2>
        <div className="dash-grid dash-grid-2">
          <Panel title={t("dashboard_eff_composition")}>
            <div className="dash-comp-block">
              <span className="dash-comp-title">{t("dashboard_eff_by_volume")}</span>
              {composition(agg.compVolume, fmtTokens)}
            </div>
            <div className="dash-comp-block">
              <span className="dash-comp-title">{t("dashboard_eff_by_cost")}</span>
              {composition(agg.compCost, fmtCost)}
            </div>
          </Panel>

          <Panel title={t("dashboard_eff_averages")}>
            <div className="dash-stat-row">
              <span className="dash-stat-label">{t("dashboard_kpi_cache_hit")}</span>
              <span className="dash-stat-val">{agg.cacheHitPct.toFixed(1)} %</span>
            </div>
            <div className="dash-stat-row">
              <span className="dash-stat-label">{t("dashboard_eff_avg_tokens")}</span>
              <span className="dash-stat-val">{fmtTokens(agg.avgTok)}</span>
            </div>
            <div className="dash-stat-row">
              <span className="dash-stat-label">{t("dashboard_kpi_cost_per_session")}</span>
              <span className="dash-stat-val cost">{fmtCost(agg.avgCost)}</span>
            </div>
          </Panel>
        </div>
      </div>

      {/* ── Santé & contexte ── */}
      <div className="dash-section">
        <h2>{t("dashboard_section_health")}</h2>
        <div className="dash-grid dash-grid-4">
          {/* Distribution pic de contexte */}
          <Panel title={t("dashboard_health_ctx_dist")}>
            <div style={{ flex: 1, minHeight: 130, minWidth: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={ctxData} margin={{ top: 5, right: 5, bottom: 0, left: -20 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: "var(--muted)", fontSize: 10 }} stroke="var(--border)" />
                <YAxis tick={{ fill: "var(--muted)", fontSize: 11 }} stroke="var(--border)" allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle}
                  formatter={(v) => [Number(v), t("dashboard_health_ctx_bucket")]} />
                <Bar dataKey="value" isAnimationActive={false} radius={[2, 2, 0, 0]}>
                  {ctxData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            </div>
          </Panel>

          {/* Erreurs */}
          <Panel title={t("dashboard_health_errors_panel")}>
            <div className="dash-stat-row">
              <span className="dash-stat-label">{t("dashboard_health_error_rate")}</span>
              <span className="dash-stat-val" style={{ color: Number(agg.errorRate) > 20 ? "var(--red)" : "var(--text)" }}>
                {agg.errorRate} %
              </span>
            </div>
            <div className="dash-stat-row">
              <span className="dash-stat-label">{t("dashboard_health_total_errors")}</span>
              <span className="dash-stat-val" style={{ color: agg.totalErrors > 0 ? "var(--red)" : "var(--text)" }}>
                {agg.totalErrors}
              </span>
            </div>
            {agg.recentErrors.length > 0 && (
              <div className="dash-err-list">
                <div className="dash-err-head">{t("dashboard_health_errors_latest")}</div>
                {agg.recentErrors.map((e, i) => (
                  <Link className="dash-err-row dash-link" key={i} to={`/sessions/${e.sessionId}`}
                    title={e.excerpt}>
                    <div className="dash-err-meta">
                      <span className="dash-err-ago">{fmtAgo(e.ts)}</span>
                      <span className="dash-err-tool">{e.tool.replace(/^mcp__/, "")}</span>
                    </div>
                    <div className="dash-err-excerpt">{e.excerpt}</div>
                  </Link>
                ))}
              </div>
            )}
          </Panel>

          {/* Fiabilité API */}
          <Panel title={t("dashboard_reliability_title")}>
            <div className="dash-stat-row">
              <span className="dash-stat-label">{t("dashboard_reliability_retries")}</span>
              <span className="dash-stat-val">{agg.apiRetryCount}</span>
            </div>
            <div className="dash-stat-row">
              <span className="dash-stat-label">{t("dashboard_reliability_errors")}</span>
              <span className="dash-stat-val">{agg.apiErrorMessageCount}</span>
            </div>
          </Panel>

          {/* Friction */}
          <Panel title={t("dashboard_friction_title")}>
            <div className="dash-stat-row">
              <span className="dash-stat-label">{t("dashboard_friction_interruptions")}</span>
              <span className="dash-stat-val">{agg.interruptionCount}</span>
            </div>
            <div className="dash-stat-row">
              <span className="dash-stat-label">{t("dashboard_friction_denials")}</span>
              <span className="dash-stat-val"
                title={Object.entries(agg.denialCounts).map(([k, v]) => `${k}: ${v}`).join(" · ")}>
                {Object.values(agg.denialCounts).reduce((a, b) => a + b, 0)}
              </span>
            </div>
            <div className="dash-stat-row">
              <span className="dash-stat-label">{t("dashboard_friction_prompts_typed")}</span>
              <span className="dash-stat-val">{agg.promptCounts.typed ?? 0}</span>
            </div>
            <div className="dash-stat-row">
              <span className="dash-stat-label">{t("dashboard_friction_prompts_sdk")}</span>
              <span className="dash-stat-val">{agg.promptCounts.sdk ?? 0}</span>
            </div>
            <div className="dash-stat-row">
              <span className="dash-stat-label">{t("dashboard_friction_prompts_other")}</span>
              <span className="dash-stat-val">
                {Object.entries(agg.promptCounts)
                  .filter(([k]) => k !== "typed" && k !== "sdk")
                  .reduce((a, [, v]) => a + v, 0)}
              </span>
            </div>
          </Panel>

          {/* Outils (tous, pas seulement MCP) */}
          {topTools.length > 0 && (
            <Panel title={t("dashboard_panel_tools")}>
              {topTools.map(([name, val]) => {
                const err = agg.toolErrorsAgg[name];
                return (
                  <div className="dash-bar-row" key={name}>
                    <span className="dash-bar-label" title={name}>{name.replace(/^mcp__/, "")}</span>
                    <div className="dash-bar-track">
                      <div className="dash-bar-fill" style={{ width: `${(val / maxToolCalls) * 100}%` }} />
                    </div>
                    <span className="dash-bar-val">
                      {val}
                      {err ? <span className="dash-bar-err"> · {err} {t("dashboard_tools_err_suffix")}</span> : null}
                    </span>
                  </div>
                );
              })}
            </Panel>
          )}

          {/* MCP */}
          {topMcp.length > 0 && (
            <Panel title={t("dashboard_health_mcp")}>
              <div className="dash-mcp-list">
                {topMcp.map(([tool, count]) => (
                  <Link className="chip sub dash-link" key={tool} title={tool}
                    to={`/sessions?mcp=${encodeURIComponent(tool)}`}>
                    {tool.replace(/^mcp__/, "")} · {count}
                  </Link>
                ))}
              </div>
            </Panel>
          )}
        </div>
      </div>
      </>
      )}
    </div>
  );
}
