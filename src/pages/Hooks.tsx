import { useEffect, useMemo, useState } from "react";
import type { HookEntry, SessionMeta } from "../types";
import { getHooks, getSessions } from "../api";
import { useT } from "../hooks/useT";
import { Picker } from "../components/ui/Picker";
import { Panel } from "../components/ui/Panel";

const SCOPE_COLOR: Record<HookEntry["scope"], string> = {
  global: "var(--accent)",
  "global-local": "var(--accent-2)",
  project: "var(--green)",
  "project-local": "var(--amber)",
};

function ScopeBadge({ scope }: { scope: HookEntry["scope"] }) {
  const t = useT();
  const color = SCOPE_COLOR[scope];
  const label =
    scope === "global"
      ? t("hooks_scope_global")
      : scope === "global-local"
        ? t("hooks_scope_global_local")
        : scope === "project"
          ? t("hooks_scope_project")
          : t("hooks_scope_project_local");
  return (
    <span className="chip" style={{ color, borderColor: color + "55" }}>
      {label}
    </span>
  );
}

interface HookGroup {
  event: string;
  hooks: HookEntry[];
}

interface HookUsageRow {
  hookName: string;
  fires: number;
  totalDurationMs: number;
  asyncResponses: number;
  errors: number;
  sessions: number;
}

/** Hook latencies are sub-second — fmtDurationMs (minutes/hours) would misrepresent them. */
function fmtHookMs(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** Sum fires/duration across merged hookNames matching a config entry's event
 *  ("Event" exact, or "Event:matcher" prefix) — best-effort join, config vs. runtime. */
function matchUsage(usage: HookUsageRow[], event: string): { fires: number; avgMs: number } | null {
  let fires = 0;
  let totalDurationMs = 0;
  for (const row of usage) {
    if (row.hookName === event || row.hookName.startsWith(event + ":")) {
      fires += row.fires;
      totalDurationMs += row.totalDurationMs;
    }
  }
  return fires ? { fires, avgMs: totalDurationMs / fires } : null;
}

function useSessionIndex() {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    getSessions().then((s) => { setSessions(s); setLoading(false); }).catch(() => setLoading(false));
  }, []);
  return { sessions, loading };
}

export default function Hooks() {
  const t = useT();
  const [hooks, setHooks] = useState<HookEntry[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [scope, setScope] = useState("");
  const { sessions } = useSessionIndex();

  useEffect(() => {
    getHooks().then(setHooks).catch((e) => setErr(String(e)));
  }, []);

  // Merge hookStats across all sessions, keyed by hookName. Absent from
  // config? Still shown — plugin hooks live outside settings.json.
  const usage = useMemo<HookUsageRow[]>(() => {
    const acc: Record<string, HookUsageRow> = {};
    for (const s of sessions) {
      if (!s.hookStats) continue;
      for (const [hookName, v] of Object.entries(s.hookStats)) {
        let row = acc[hookName];
        if (!row) acc[hookName] = row = { hookName, fires: 0, totalDurationMs: 0, asyncResponses: 0, errors: 0, sessions: 0 };
        row.fires += v.fires;
        row.totalDurationMs += v.totalDurationMs;
        row.asyncResponses += v.asyncResponses;
        row.errors += v.errors;
        row.sessions++;
      }
    }
    return Object.values(acc).sort((a, b) => b.fires - a.fires);
  }, [sessions]);

  const scopeOpts = useMemo(
    () => [
      { v: "global", l: t("hooks_scope_global") },
      { v: "global-local", l: t("hooks_scope_global_local") },
      { v: "project", l: t("hooks_scope_project") },
      { v: "project-local", l: t("hooks_scope_project_local") },
    ],
    [t],
  );

  const rows = useMemo(
    () => hooks.filter((h) => !scope || h.scope === scope),
    [hooks, scope],
  );

  const groups = useMemo<HookGroup[]>(() => {
    const map = new Map<string, HookGroup>();
    for (const h of rows) {
      let g = map.get(h.event);
      if (!g) map.set(h.event, (g = { event: h.event, hooks: [] }));
      g.hooks.push(h);
    }
    return [...map.values()].sort((a, b) => a.event.localeCompare(b.event));
  }, [rows]);

  function renderHook(h: HookEntry, i: number) {
    return (
      <div
        key={`${h.scope}/${h.event}/${h.matcher}/${i}`}
        className="msg"
        style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 6 }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <ScopeBadge scope={h.scope} />
          {h.projectLabel && (
            <span style={{ color: "var(--muted)", fontSize: 12 }}>{h.projectLabel}</span>
          )}
          <span style={{ color: "var(--muted)", fontSize: 12 }}>
            {t("hooks_matcher_label")}: {h.matcher || t("hooks_matcher_all")}
          </span>
          {(() => {
            const m = matchUsage(usage, h.event);
            return m ? (
              <span style={{ color: "var(--muted)", fontSize: 11 }}>
                × {m.fires} · ~{fmtHookMs(m.avgMs)}
              </span>
            ) : null;
          })()}
          <span style={{ flex: 1 }} />
          {h.async && (
            <span className="chip" style={{ color: "var(--accent-2)", fontSize: 11 }}>
              {t("hooks_async")}
            </span>
          )}
          {!h.async && (
            <span className="chip" style={{ color: "var(--muted)", fontSize: 11 }}>
              {t("hooks_sync")}
            </span>
          )}
          {h.timeout != null && (
            <span className="chip" style={{ color: "var(--muted)", fontSize: 11 }}>
              {t("hooks_timeout")} {h.timeout}s
            </span>
          )}
        </div>
        <code
          title={`${h.command}\n\n${h.sourceFile}`}
          style={{
            fontSize: 12,
            color: "var(--text)",
            background: "var(--panel-2)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            padding: "4px 8px",
            overflowX: "auto",
            whiteSpace: "pre",
          }}
        >
          {h.command}
        </code>
      </div>
    );
  }

  return (
    <div>
      {usage.length > 0 && (
        <Panel title={t("hooks_usage_title")}>
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>{t("hooks_usage_col_hook")}</th>
                  <th className="num">{t("hooks_usage_col_fires")}</th>
                  <th className="num">{t("hooks_usage_col_avg")}</th>
                  <th className="num">{t("hooks_usage_col_async")}</th>
                  <th className="num">{t("hooks_usage_col_errors")}</th>
                  <th className="num">{t("hooks_usage_col_sessions")}</th>
                </tr>
              </thead>
              <tbody>
                {usage.map((row) => (
                  <tr key={row.hookName}>
                    <td>{row.hookName}</td>
                    <td className="num">{row.fires}</td>
                    <td className="num">{row.fires ? fmtHookMs(row.totalDurationMs / row.fires) : "—"}</td>
                    <td className="num">{row.asyncResponses}</td>
                    <td className="num">{row.errors}</td>
                    <td className="num">{row.sessions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <div className="controls">
        <Picker label={t("hooks_filter_scope")} value={scope} set={setScope} opts={scopeOpts} />
        <span style={{ color: "var(--muted)", fontSize: 13 }}>
          {rows.length} {rows.length === 1 ? t("hooks_count_one") : t("hooks_count_many")}
        </span>
      </div>

      {err && <p style={{ color: "var(--red)" }}>{err}</p>}
      {!err && rows.length === 0 && <p style={{ color: "var(--muted)" }}>{t("hooks_empty")}</p>}

      {groups.map((g) => (
        <div key={g.event}>
          <div
            style={{
              margin: "18px 0 8px",
              paddingBottom: 4,
              borderBottom: "1px solid var(--border)",
              color: "var(--muted)",
              fontSize: 12,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: 0.4,
              display: "flex",
              gap: 8,
            }}
          >
            <span>{g.event}</span>
            <span style={{ opacity: 0.6 }}>{g.hooks.length}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {g.hooks.map(renderHook)}
          </div>
        </div>
      ))}
    </div>
  );
}
