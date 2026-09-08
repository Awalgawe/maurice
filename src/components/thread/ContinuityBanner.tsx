import { Link } from "react-router-dom";
import type { LineageRef, SessionContinuity } from "../../types";
import { useFmt } from "../../hooks/useFmt";
import { useT, type I18nKey } from "../../hooks/useT";

/** Enough of the title to recognize the session, never a paragraph. Absent on
 *  most transcripts — the id is what identifies a lineage member anyway. */
function title(r: LineageRef): string | null {
  const t = (r.title || "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > 60 ? t.slice(0, 60) + "…" : t;
}

/**
 * Cross-file continuation of a conversation: the transcript being read is only
 * one file of a lineage (see SessionContinuity). Rendered in reading order —
 * where the rest of the conversation is, then where this fragment came from,
 * then the weaker relations.
 */
export function ContinuityBanner({ continuity }: { continuity: SessionContinuity }) {
  const t = useT();
  const { fmtDate } = useFmt();

  const relations: { key: I18nKey; refs: LineageRef[] }[] = [
    { key: "continuity_in", refs: continuity.continuedIn },
    { key: "continuity_from", refs: continuity.continuedFrom },
    { key: "continuity_diverged", refs: continuity.diverged },
    { key: "continuity_duplicate", refs: continuity.duplicates },
  ];
  const rows = relations.filter((r) => r.refs.length > 0);

  return (
    <div className="continuity-banner" title={t("continuity_evidence")}>
      {rows.map(({ key, refs }) => (
        <div className="continuity-row" key={key}>
          <span className="continuity-label">⑂ {t(key)}</span>
          <span className="continuity-refs">
            {refs.map((r) => (
              <Link className="continuity-link" key={r.sessionId} to={`/sessions/${r.sessionId}`}>
                <span className="continuity-id">{r.sessionId.slice(0, 8)}</span>
                {title(r) && <span className="continuity-title">{title(r)}</span>}
                <span className="muted">
                  {r.messageCount} {t("detail_fork_msgs")} · {fmtDate(r.end)}
                </span>
              </Link>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}
