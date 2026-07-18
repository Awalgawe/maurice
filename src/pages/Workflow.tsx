import { Fragment, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { SessionMeta } from "../types";
import { fmtDurationMs, skillLabel, totalTokens } from "../format";
import { useSortable } from "../hooks/useSortable";
import { useSessions } from "../hooks/useSessions";
import { useFmt } from "../hooks/useFmt";
import { useT } from "../hooks/useT";
import { SortHeader } from "../components/ui/SortHeader";
import { ErrorState } from "../components/ui/ErrorState";

type Pivot = "skill" | "ticket" | "branch";
type SortKey = "label" | "project" | "sessions" | "tokens" | "cost" | "duration" | "errors";

interface Group {
  key: string;
  label: string;
  sublabel?: string;
  sessions: SessionMeta[];
  tokens: number;
  cost: number;
  duration: number;
  errors: number;
}

export default function Workflow() {
  const t = useT();
  const { fmtTokens, fmtCost } = useFmt();
  const { sessions, status, error, reload } = useSessions();
  const [pivot, setPivot] = useState<Pivot>("skill");
  const { sortKey, sortDir, toggle, sortBy } = useSortable<SortKey>("cost", -1);

  const groups = useMemo(() => {
    const map = new Map<string, Group>();
    // tokens/cost are passed explicitly so the skill pivot can use per-skill
    // attribution (a session's tokens are split across the skills it used)
    // rather than counting the whole session in every group it touches.
    const add = (key: string, label: string, s: SessionMeta, tokens: number, cost: number, sublabel?: string) => {
      let g = map.get(key);
      if (!g) {
        g = { key, label, sublabel, sessions: [], tokens: 0, cost: 0, duration: 0, errors: 0 };
        map.set(key, g);
      }
      g.sessions.push(s);
      g.tokens += tokens;
      g.cost += cost;
      // Not split per-skill (no per-skill duration data): full session duration
      // counted in every group it belongs to, same convention as errors above.
      g.duration += s.totalTurnDurationMs ?? 0;
      g.errors += s.errorCount;
    };
    for (const s of sessions) {
      if (pivot === "skill") {
        // Use the per-skill breakdown computed server-side.
        const keys = Object.keys(s.skillTokens || {});
        if (keys.length === 0) add("(aucun)", t("workflow_no_skill"), s, totalTokens(s.tokens), s.estCostUSD);
        else
          for (const k of keys) {
            const label = k === "(aucun)" ? t("workflow_no_skill") : skillLabel(k);
            add(k, label, s, s.skillTokens[k] || 0, s.skillCost[k] || 0);
          }
      } else if (pivot === "ticket") {
        add(s.ticket || "(aucun)", s.ticket || t("workflow_no_ticket"), s, totalTokens(s.tokens), s.estCostUSD);
      } else {
        if (s.branches.length === 0)
          add(`${s.projectId}::(aucune)`, t("workflow_no_branch"), s, totalTokens(s.tokens), s.estCostUSD, s.projectLabel);
        else
          for (const b of s.branches)
            add(`${s.projectId}::${b}`, b, s, totalTokens(s.tokens), s.estCostUSD, s.projectLabel);
      }
    }
    return [...map.values()];
  }, [sessions, pivot, t]);

  const sortedGroups = useMemo(() => {
    const val = (g: Group): number | string => {
      switch (sortKey) {
        case "label":    return g.label;
        case "project":  return g.sublabel ?? "";
        case "sessions": return g.sessions.length;
        case "tokens":   return g.tokens;
        case "cost":     return g.cost;
        case "duration": return g.duration;
        case "errors":   return g.errors;
      }
    };
    return sortBy(groups, val);
  }, [groups, sortKey, sortDir]);

  const [open, setOpen] = useState<string | null>(null);
  const pivotLabels: Record<Pivot, string> = {
    skill: t("workflow_pivot_skill"),
    ticket: t("workflow_pivot_ticket"),
    branch: t("workflow_pivot_branch"),
  };
  const sortProps = { active: sortKey, dir: sortDir, onSort: toggle, idle: " ↕" };

  if (status === "error") return <ErrorState message={error} onRetry={reload} />;
  if (status === "loading") return <div className="center">{t("sessions_loading")}</div>;

  return (
    <div>
      <div className="controls">
        <span className="muted">{t("workflow_pivot_label")}</span>
        {(["skill", "ticket", "branch"] as Pivot[]).map((p) => (
          <button key={p} className={pivot === p ? "active" : ""} onClick={() => setPivot(p)}>
            {pivotLabels[p]}
          </button>
        ))}
        <span className="hint">{groups.length} {t("workflow_groups")}</span>
      </div>

      <table>
        <thead>
          <tr>
            <SortHeader k="label" label={pivotLabels[pivot]} {...sortProps} />
            {pivot === "branch" && <SortHeader k="project" label={t("workflow_col_project")} {...sortProps} />}
            <SortHeader k="sessions" label={t("workflow_col_sessions")} className="num" {...sortProps} />
            <SortHeader k="tokens" label={t("workflow_col_tokens")} className="num" {...sortProps} />
            <SortHeader k="cost" label={t("workflow_col_cost")} className="num" {...sortProps} />
            <SortHeader k="duration" label={t("workflow_col_duration")} className="num" {...sortProps} />
            <SortHeader k="errors" label={t("workflow_col_errors")} className="num" {...sortProps} />
          </tr>
        </thead>
        <tbody>
          {sortedGroups.map((g) => (
            <Fragment key={g.key}>
              <tr style={{ cursor: "pointer" }} onClick={() => setOpen(open === g.key ? null : g.key)}>
                <td>
                  <strong>{open === g.key ? "▼ " : "▶ "}{g.label}</strong>
                </td>
                {pivot === "branch" && <td className="muted">{g.sublabel}</td>}
                <td className="num">{g.sessions.length}</td>
                <td className="num">{fmtTokens(g.tokens)}</td>
                <td className="num cost">{fmtCost(g.cost)}</td>
                <td className="num muted">{g.duration > 0 ? fmtDurationMs(g.duration) : ""}</td>
                <td className="num">{g.errors || ""}</td>
              </tr>
              {open === g.key &&
                g.sessions
                  .slice()
                  .sort((a, b) => {
                    const tv = (s: SessionMeta) =>
                      pivot === "skill" ? s.skillTokens[g.key] || 0 : totalTokens(s.tokens);
                    const cv = (s: SessionMeta) =>
                      pivot === "skill" ? s.skillCost[g.key] || 0 : s.estCostUSD;
                    switch (sortKey) {
                      case "tokens":   return sortDir * (tv(a) - tv(b));
                      case "cost":     return sortDir * (cv(a) - cv(b));
                      case "duration": return sortDir * ((a.totalTurnDurationMs ?? 0) - (b.totalTurnDurationMs ?? 0));
                      case "errors":   return sortDir * (a.errorCount - b.errorCount);
                      case "project":  return sortDir * a.projectLabel.localeCompare(b.projectLabel);
                      case "sessions": return sortDir * (a.messageCount - b.messageCount);
                      default:         return (b.end || "").localeCompare(a.end || "");
                    }
                  })
                  .map((s) => {
                    // In the skill pivot, show this session's share for the skill.
                    const rowTokens =
                      pivot === "skill" ? s.skillTokens[g.key] || 0 : totalTokens(s.tokens);
                    const rowCost =
                      pivot === "skill" ? s.skillCost[g.key] || 0 : s.estCostUSD;
                    return (
                      <tr key={g.key + s.id} style={{ background: "var(--panel)" }}>
                        <td style={{ paddingLeft: 28 }}>
                          <Link to={`/sessions/${s.id}`}>{s.projectLabel}</Link>
                          <span className="muted" style={{ fontSize: 12 }}>
                            {" "}
                            {s.aiTitle || s.firstUserPrompt}
                          </span>
                        </td>
                        {pivot === "branch" && <td />}
                        <td className="num muted">{s.messageCount} {t("workflow_msgs")}</td>
                        <td className="num">{fmtTokens(rowTokens)}</td>
                        <td className="num cost">{fmtCost(rowCost)}</td>
                        <td className="num muted">{s.totalTurnDurationMs ? fmtDurationMs(s.totalTurnDurationMs) : ""}</td>
                        <td className="num">{s.errorCount || ""}</td>
                      </tr>
                    );
                  })}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
