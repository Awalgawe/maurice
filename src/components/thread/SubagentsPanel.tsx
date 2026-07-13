import { Link } from "react-router-dom";
import type { SubagentRef } from "../../types";
import { modelLabel } from "../../format";
import { useFmt } from "../../hooks/useFmt";
import { useT } from "../../hooks/useT";
import { Panel } from "../ui/Panel";

/** One level of the subagent tree: the direct children of the current node
 *  (session root or a subagent), each rendered as a minimal key/value table.
 *  Drilling in is done by navigating to a child's own view — never by indenting
 *  the whole tree, which wouldn't survive deep nesting. `all` is the flat set of
 *  this node's descendants; the direct children are those not referenced as a
 *  child of any other node in the set, and the "subagents" row shows how many
 *  are nested inside each. */
export function SubagentsPanel({ all, sessionId }: { all: SubagentRef[]; sessionId: string }) {
  const t = useT();
  const { fmtCost } = useFmt();
  if (all.length === 0) return null;

  const byRef = new Map(all.map((s) => [s.ref, s]));
  const childOfSomeone = new Set(all.flatMap((s) => s.childRefs));
  const directChildren = all.filter((s) => !childOfSomeone.has(s.ref));

  // Transitive descendant count of a node (cycle-guarded).
  const descendantCount = (ref: string, seen: Set<string>): number => {
    const node = byRef.get(ref);
    if (!node) return 0;
    let n = 0;
    for (const c of node.childRefs) {
      if (seen.has(c)) continue;
      seen.add(c);
      n += 1 + descendantCount(c, seen);
    }
    return n;
  };

  return (
    <Panel title={`${t("detail_panel_subagents")} (${all.length})`}>
      <div className="kv" style={{ marginBottom: 8 }}>
        <span className="k">{t("detail_subagents_total")}</span>
        <span className="v cost">{fmtCost(all.reduce((a, s) => a + s.estCostUSD, 0))}</span>
      </div>
      {directChildren.map((s) => {
        const nested = descendantCount(s.ref, new Set([s.ref]));
        return (
          <Link
            key={s.ref}
            to={`/sessions/${sessionId}/subagents/${encodeURIComponent(s.ref)}`}
            className="subagent-item"
          >
            <div className="subagent-item-title">{s.agentType || "agent"}</div>
            {s.description && (
              <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>{s.description}</div>
            )}
            <div className="kv">
              <span className="k">{t("detail_subagent_messages")}</span>
              <span className="v">{s.messageCount}</span>
            </div>
            <div className="kv">
              <span className="k">{t("detail_models")}</span>
              <span className="v">
                {s.models.length === 0 ? t("detail_subagent_no_model") : s.models.map(modelLabel).join(", ")}
              </span>
            </div>
            <div className="kv">
              <span className="k">{t("detail_subagent_self_cost")}</span>
              <span className="v cost">{fmtCost(s.estCostUSD)}</span>
            </div>
            {nested > 0 && (
              <div className="kv">
                <span className="k">{t("detail_cost_with_sub")}</span>
                <span className="v cost">{fmtCost(s.costWithChildrenUSD)}</span>
              </div>
            )}
            {nested > 0 && (
              <div className="kv">
                <span className="k">{t("detail_panel_subagents")}</span>
                <span className="v">{nested}</span>
              </div>
            )}
          </Link>
        );
      })}
    </Panel>
  );
}
