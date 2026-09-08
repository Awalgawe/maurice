import { Fragment, useEffect, useMemo, useState } from "react";
import { messageLink } from "../lib/messageLink";
import { Link, useSearchParams } from "react-router-dom";
import type { Facets, SearchHit, SessionMeta } from "../types";
import { getFilters, search as apiSearch } from "../api";
import { skillLabel, modelLabel, totalTokens } from "../format";
import { useSortable } from "../hooks/useSortable";
import { useSessions } from "../hooks/useSessions";
import { usePeers } from "../hooks/usePeers";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useFmt } from "../hooks/useFmt";
import { useT } from "../hooks/useT";
import { Chip } from "../components/ui/Chip";
import { ErrorState } from "../components/ui/ErrorState";
import { ContextBar } from "../components/ui/ContextBar";
import { Picker } from "../components/ui/Picker";
import { SortHeader } from "../components/ui/SortHeader";

type SortKey =
  | "end"
  | "messageCount"
  | "tokens"
  | "estCostUSD"
  | "cacheRewriteWastedUSD"
  | "peakContextPct";

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
  const { sessions, status, error, reload } = useSessions(true);
  const { graph: peers } = usePeers();
  const [facets, setFacets] = useState<Facets | null>(null);
  const [facetsErr, setFacetsErr] = useState<string | null>(null);
  const [facetsNonce, setFacetsNonce] = useState(0);

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
  const [searchErr, setSearchErr] = useState<string | null>(null);

  // Facets refresh alongside the session index (also on window focus). They only
  // populate filter options, so a failure doesn't block the table — but it's
  // surfaced (with retry) rather than swallowed, so empty pickers aren't mistaken
  // for "no filters available".
  useEffect(() => {
    let live = true;
    const load = () => {
      getFilters()
        .then((f) => { if (live) { setFacets(f); setFacetsErr(null); } })
        .catch((e) => { if (live) setFacetsErr(String(e)); });
    };
    load();
    window.addEventListener("focus", load);
    return () => { live = false; window.removeEventListener("focus", load); };
  }, [facetsNonce]);

  // Debounced full-text search. The `live` guard drops a stale in-flight response
  // so a slow earlier query can't overwrite the results of a newer one.
  useEffect(() => {
    if (query.trim().length < 3) {
      setHits(null);
      setSearchErr(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      apiSearch(query)
        .then((h) => { if (live) { setHits(h); setSearchErr(null); } })
        .catch((e) => { if (live) { setHits(null); setSearchErr(String(e)); } });
    }, 300);
    return () => { live = false; clearTimeout(timer); };
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

  // Deep-link a search hit to its message: right view (?branch), right page,
  // anchor+flash. Page size lives in messageLink, shared with SessionDetail.
  // Cross-session traffic, from the shared /api/peers graph — never from the
  // session payload, which knows nothing of the other end. A failed fetch shows
  // no badge rather than "0".
  function peerBadge(id: string) {
    const own = peers?.bySession[id];
    if (!own) return null;
    const n = own.peers.length;
    // Count only, no noun: a "1 Pairs" would be wrong in every language that
    // inflects. The wording lives in the title.
    const title =
      `${t("peer_badge_title")} · ${n} ${t("peer_badge_label")}` +
      (own.unresolvedCount > 0 ? ` · ${own.unresolvedCount} ${t("peer_unresolved_title")}` : "");
    return (
      <Chip title={title}>
        ⇄ {n}
        {own.unresolvedCount > 0 ? " ⚠" : ""}
      </Chip>
    );
  }

  function sessionLink(id: string): string {
    const hit = hitBySession?.get(id);
    return (hit && messageLink(id, hit)) || `/sessions/${id}`;
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
        case "cacheRewriteWastedUSD":
          return s.cacheRewriteWastedUSD || 0;
        default:
          return s[sortKey];
      }
    };
    return sortBy(filtered, val);
  }, [sessions, project, ticket, skill, model, mcp, errorsOnly, hitBySession, sortKey, sortDir]);

  // 13 readable columns don't fit narrow windows; drop the least critical ones
  // instead of squeezing or scrolling (breakpoints sized with the fixed column
  // widths in index.css). Rendered conditionally so colgroup/th/td stay aligned.
  const hideSubErr = useMediaQuery("(max-width: 1219px)");
  const hideSkills = useMediaQuery("(max-width: 1100px)");
  const hideModel = useMediaQuery("(max-width: 1020px)");
  const visibleCols = 13 - (hideSubErr ? 2 : 0) - (hideSkills ? 1 : 0) - (hideModel ? 1 : 0);

  if (status === "error") return <ErrorState message={error} onRetry={reload} />;
  if (status === "loading") return <div className="center">{t("sessions_loading")}</div>;
  if (!sessions.length) return <div className="center">{t("sessions_empty")}</div>;

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
        {searchErr && <span className="hint" style={{ color: "var(--red)" }}>{searchErr}</span>}
        {facetsErr && (
          <span className="hint async-error-inline" style={{ color: "var(--red)" }}>
            {t("sessions_filters_error")}
            <button type="button" className="retry-btn" onClick={() => setFacetsNonce((n) => n + 1)}>
              {t("async_retry")}
            </button>
          </span>
        )}
        <span className="hint">{rows.length} {t("sessions_count")}</span>
      </div>

      <table className="sessions-table">
        <colgroup>
          <col className="c-project" />
          <col className="c-ticket" />
          <col className="c-branch" />
          {!hideSkills && <col className="c-skills" />}
          {!hideModel && <col className="c-model" />}
          <col className="c-date" />
          <col className="c-msgs" />
          <col className="c-tokens" />
          <col className="c-cost" />
          <col className="c-waste" />
          <col className="c-ctx" />
          {!hideSubErr && <col className="c-err" />}
          {!hideSubErr && <col className="c-sub" />}
        </colgroup>
        <thead>
          <tr>
            <th>{t("sessions_col_project")}</th>
            <th>{t("sessions_col_ticket")}</th>
            <th>{t("sessions_col_branch")}</th>
            {!hideSkills && <th>{t("sessions_col_skills")}</th>}
            {!hideModel && <th>{t("sessions_col_model")}</th>}
            <SortHeader k="end" label={t("sessions_col_date")} {...sortProps} />
            <SortHeader k="messageCount" label={t("sessions_col_msgs")} className="num" {...sortProps} />
            <SortHeader k="tokens" label={t("sessions_col_tokens")} className="num" {...sortProps} />
            <SortHeader k="estCostUSD" label={t("sessions_col_cost")} className="num" {...sortProps} />
            <SortHeader k="cacheRewriteWastedUSD" label={t("sessions_col_waste")} className="num" {...sortProps} />
            <SortHeader k="peakContextPct" label={t("sessions_col_ctx")} className="num" {...sortProps} />
            {!hideSubErr && <th className="num">{t("sessions_col_err")}</th>}
            {!hideSubErr && <th className="num">{t("sessions_col_sub")}</th>}
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
                <td colSpan={visibleCols}>{dayLabel(key)}</td>
              </tr>
            )}
            <tr>
              <td>
                <Link to={sessionLink(s.id)}>
                  <strong>{s.projectLabel}</strong>
                </Link>
                {peerBadge(s.id)}
                <div className="muted" style={{ fontSize: 12 }}>
                  {hitBySession?.has(s.id) ? (
                    <>
                      {hitBySession.get(s.id)!.fork !== null && (
                        <span className="hit-fork-badge">{t("sessions_hit_fork")} </span>
                      )}
                      {renderExcerpt(hitBySession.get(s.id)!.excerpt)}
                    </>
                  ) : (
                    s.aiTitle || s.firstUserPrompt || <em>—</em>
                  )}
                </div>
              </td>
              <td>{s.ticket ? <Chip variant="ticket" title={s.ticket}>{s.ticket}</Chip> : ""}</td>
              <td>
                {s.branches.slice(0, 2).map((b) => (
                  <Chip key={b} title={b}>{b}</Chip>
                ))}
                {s.branches.length > 2 && <Chip>+{s.branches.length - 2}</Chip>}
              </td>
              {!hideSkills && (
                <td>
                  {s.skills.slice(0, 3).map((k) => (
                    <Chip variant="skill" key={k} title={skillLabel(k)}>{skillLabel(k)}</Chip>
                  ))}
                  {s.skills.length > 3 && <Chip>+{s.skills.length - 3}</Chip>}
                </td>
              )}
              {!hideModel && (
                <td>
                  {s.models.slice(0, 2).map((m) => (
                    <Chip variant="model" key={m} title={modelLabel(m)}>{modelLabel(m)}</Chip>
                  ))}
                  {s.models.length > 2 && <Chip>+{s.models.length - 2}</Chip>}
                </td>
              )}
              <td className="muted date">{fmtDate(s.end)}</td>
              <td className="num">{s.messageCount}</td>
              <td className="num">{fmtTokens(totalTokens(s.tokens))}</td>
              <td className="num cost">{fmtCost(s.estCostUSD)}</td>
              <td className="num">
                {(s.cacheRewriteWastedUSD || 0) > 0 ? (
                  <Chip
                    variant="warn"
                    title={`${s.cacheRewriteCount} ${t("sessions_waste_title")}`}
                  >
                    ⚠ {fmtCost(s.cacheRewriteWastedUSD)}
                  </Chip>
                ) : (
                  ""
                )}
              </td>
              <td className="num">
                <ContextBar pct={s.peakContextPct} />
              </td>
              {!hideSubErr && (
                <td className="num">
                  {s.errorCount > 0 ? <Chip variant="err">{s.errorCount}</Chip> : ""}
                </td>
              )}
              {!hideSubErr && (
                <td className="num">
                  {s.subagentCount > 0 ? <Chip variant="sub">{s.subagentCount}</Chip> : ""}
                </td>
              )}
            </tr>
            </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
