import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { Facets, SearchHit, SessionMeta } from "../types";
import { getFilters, getSessions, search as apiSearch } from "../api";
import { skillLabel, modelLabel, totalTokens } from "../format";
import { useSortable } from "../hooks/useSortable";
import { useFmt } from "../hooks/useFmt";
import { useT } from "../hooks/useT";
import { Chip } from "../components/ui/Chip";
import { ContextBar } from "../components/ui/ContextBar";
import { Picker } from "../components/ui/Picker";
import { SortHeader } from "../components/ui/SortHeader";

type SortKey = "end" | "messageCount" | "tokens" | "estCostUSD" | "peakContextPct";

const pad = (n: number) => String(n).padStart(2, "0");

function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local-time YYYY-MM-DD of an ISO timestamp; "" when the session has no end date. */
function dayKey(iso: string | null): string {
  return iso ? ymd(new Date(iso)) : "";
}

export default function Sessions() {
  const t = useT();
  const { fmtDate, fmtDayLong, fmtTokens, fmtCost } = useFmt();
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Filters can be seeded from the URL (Dashboard drill-down links), read once at mount.
  const [params] = useSearchParams();
  const [project, setProject] = useState(() => params.get("project") ?? "");
  const [ticket, setTicket] = useState(() => params.get("ticket") ?? "");
  const [skill, setSkill] = useState(() => params.get("skill") ?? "");
  const [model, setModel] = useState(() => params.get("model") ?? "");
  const [mcp, setMcp] = useState(() => params.get("mcp") ?? "");
  const [errorsOnly, setErrorsOnly] = useState(() => params.get("errors") === "1");
  const { sortKey, sortDir, toggle, sortBy } = useSortable<SortKey>("end", -1);

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);

  // Fetch on mount, then again whenever the window regains focus — so the live
  // session (which keeps growing on disk) shows up without a manual reload.
  useEffect(() => {
    const load = () => {
      getSessions().then(setSessions).catch((e) => setErr(String(e)));
      getFilters().then(setFacets).catch(() => {});
    };
    load();
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, []);

  // Debounced full-text search.
  useEffect(() => {
    if (query.trim().length < 3) {
      setHits(null);
      return;
    }
    const t = setTimeout(() => {
      apiSearch(query).then(setHits).catch(() => setHits([]));
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const hitBySession = useMemo(
    () => (hits ? new Map(hits.map((h) => [h.sessionId, h])) : null),
    [hits],
  );

  function renderExcerpt(text: string): React.ReactNode {
    if (!text.includes("\x01")) return text;
    const parts = text.split(/\x01|\x02/);
    return parts.map((p, i) => (i % 2 === 1 ? <mark key={i}>{p}</mark> : p));
  }

  const rows = useMemo(() => {
    const filtered = sessions.filter((s) => {
      if (project && s.projectId !== project) return false;
      if (ticket && s.ticket !== ticket) return false;
      if (skill && !s.skills.includes(skill)) return false;
      if (model && !s.models.includes(model)) return false;
      if (mcp && !s.mcpTools.includes(mcp)) return false;
      if (errorsOnly && !s.hasErrors) return false;
      if (hitBySession && !hitBySession.has(s.id)) return false;
      return true;
    });
    const val = (s: SessionMeta): number | string => {
      switch (sortKey) {
        case "tokens":
          return totalTokens(s.tokens);
        case "end":
          return s.end || "";
        default:
          return s[sortKey];
      }
    };
    return sortBy(filtered, val);
  }, [sessions, project, ticket, skill, model, mcp, errorsOnly, hitBySession, sortKey, sortDir]);

  if (err) return <div className="center">{t("sessions_error_prefix")}{err}</div>;
  if (!sessions.length) return <div className="center">{t("sessions_loading")}</div>;

  const sortProps = { active: sortKey, dir: sortDir, onSort: toggle };

  // Day separators only make sense when rows are ordered by date.
  const showDayRows = sortKey === "end";
  const now = new Date();
  const todayKey = ymd(now);
  const yesterdayKey = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const dayLabel = (key: string) =>
    key === "" ? "—"
    : key === todayKey ? t("sessions_day_today")
    : key === yesterdayKey ? t("sessions_day_yesterday")
    : fmtDayLong(key);

  return (
    <div>
      <div className="controls">
        <input
          type="search"
          placeholder={t("sessions_search_placeholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Picker label={t("sessions_filter_project")} value={project} set={setProject} opts={facets?.projects.map((p) => ({ v: p.value, l: `${p.label} (${p.count})` }))} />
        <Picker label={t("sessions_filter_ticket")} value={ticket} set={setTicket} opts={facets?.tickets.map((p) => ({ v: p.value, l: `${p.value} (${p.count})` }))} />
        <Picker label={t("sessions_filter_skill")} value={skill} set={setSkill} opts={facets?.skills.map((p) => ({ v: p.value, l: `${skillLabel(p.value)} (${p.count})` }))} />
        <Picker label={t("sessions_filter_model")} value={model} set={setModel} opts={facets?.models.map((p) => ({ v: p.value, l: `${p.value} (${p.count})` }))} />
        <Picker label={t("sessions_filter_mcp")} value={mcp} set={setMcp} opts={facets?.mcpTools.map((p) => ({ v: p.value, l: `${p.value.replace(/^mcp__/, "")} (${p.count})` }))} />
        <button className={errorsOnly ? "active" : ""} onClick={() => setErrorsOnly((v) => !v)}>
          {t("sessions_errors_only")}
        </button>
        <span className="hint">{rows.length} {t("sessions_count")}</span>
      </div>

      <table className="sessions-table">
        <colgroup>
          <col />
          <col style={{ width: 88 }} />
          <col style={{ width: 150 }} />
          <col style={{ width: 132 }} />
          <col style={{ width: 100 }} />
          <col style={{ width: 132 }} />
          <col style={{ width: 56 }} />
          <col style={{ width: 74 }} />
          <col style={{ width: 74 }} />
          <col style={{ width: 86 }} />
          <col style={{ width: 52 }} />
          <col style={{ width: 52 }} />
        </colgroup>
        <thead>
          <tr>
            <th>{t("sessions_col_project")}</th>
            <th>{t("sessions_col_ticket")}</th>
            <th>{t("sessions_col_branch")}</th>
            <th>{t("sessions_col_skills")}</th>
            <th>{t("sessions_col_model")}</th>
            <SortHeader k="end" label={t("sessions_col_date")} {...sortProps} />
            <SortHeader k="messageCount" label={t("sessions_col_msgs")} className="num" {...sortProps} />
            <SortHeader k="tokens" label={t("sessions_col_tokens")} className="num" {...sortProps} />
            <SortHeader k="estCostUSD" label={t("sessions_col_cost")} className="num" {...sortProps} />
            <SortHeader k="peakContextPct" label={t("sessions_col_ctx")} className="num" {...sortProps} />
            <th className="num">{t("sessions_col_err")}</th>
            <th className="num">{t("sessions_col_sub")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s, i) => {
            const key = dayKey(s.end);
            const newDay = showDayRows && (i === 0 || key !== dayKey(rows[i - 1].end));
            return (
            <Fragment key={s.projectId + "/" + s.id}>
            {newDay && (
              <tr className="day-row">
                <td colSpan={12}>{dayLabel(key)}</td>
              </tr>
            )}
            <tr>
              <td>
                <Link to={`/sessions/${s.id}`}>
                  <strong>{s.projectLabel}</strong>
                </Link>
                <div className="muted" style={{ fontSize: 12 }}>
                  {hitBySession?.has(s.id)
                    ? renderExcerpt(hitBySession.get(s.id)!.excerpt)
                    : (s.firstUserPrompt || <em>—</em>)}
                </div>
              </td>
              <td>{s.ticket ? <Chip variant="ticket">{s.ticket}</Chip> : ""}</td>
              <td>
                {s.branches.slice(0, 2).map((b) => (
                  <Chip key={b}>{b}</Chip>
                ))}
                {s.branches.length > 2 && <Chip>+{s.branches.length - 2}</Chip>}
              </td>
              <td>
                {s.skills.slice(0, 3).map((k) => (
                  <Chip variant="skill" key={k}>{skillLabel(k)}</Chip>
                ))}
                {s.skills.length > 3 && <Chip>+{s.skills.length - 3}</Chip>}
              </td>
              <td>
                {s.models.slice(0, 2).map((m) => (
                  <Chip variant="model" key={m}>{modelLabel(m)}</Chip>
                ))}
                {s.models.length > 2 && <Chip>+{s.models.length - 2}</Chip>}
              </td>
              <td className="muted date">{fmtDate(s.end)}</td>
              <td className="num">{s.messageCount}</td>
              <td className="num">{fmtTokens(totalTokens(s.tokens))}</td>
              <td className="num cost">{fmtCost(s.estCostUSD)}</td>
              <td className="num">
                <ContextBar pct={s.peakContextPct} />
              </td>
              <td className="num">
                {s.errorCount > 0 ? <Chip variant="err">{s.errorCount}</Chip> : ""}
              </td>
              <td className="num">
                {s.subagentCount > 0 ? <Chip variant="sub">{s.subagentCount}</Chip> : ""}
              </td>
            </tr>
            </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
