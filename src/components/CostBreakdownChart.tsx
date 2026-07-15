import type { TokenTotals } from "../types";
import { useFmt } from "../hooks/useFmt";
import { useT } from "../hooks/useT";

/** At-a-glance stacked bar of where a node's (session or subagent) estimated cost
 *  actually goes: input/output/cache-read/cache-write, cache-write split into
 *  its avoidable-rewrite waste vs. the rest, and the node's own subagents'
 *  share. Caller wraps it in a Panel — used inside "Cost & tokens" for both
 *  the session root and any subagent detail (same shape either way). */
export function CostBreakdownChart({
  costByComponent,
  cacheRewriteWastedUSD,
  subagentsCostUSD,
}: {
  costByComponent: TokenTotals;
  cacheRewriteWastedUSD: number;
  subagentsCostUSD: number;
}) {
  const t = useT();
  const { fmtCost } = useFmt();

  const cacheWasted = Math.min(cacheRewriteWastedUSD, costByComponent.cacheCreate);
  const cacheRegular = Math.max(0, costByComponent.cacheCreate - cacheWasted);

  const slices = [
    { key: "input", label: t("detail_token_input"), value: costByComponent.input, color: "var(--accent)" },
    { key: "output", label: t("detail_token_output"), value: costByComponent.output, color: "var(--accent-2)" },
    { key: "cacheRead", label: t("detail_token_cache_read"), value: costByComponent.cacheRead, color: "var(--green)" },
    { key: "cacheWrite", label: t("detail_token_cache_write"), value: cacheRegular, color: "var(--amber)" },
    { key: "cacheWasted", label: t("detail_cost_chart_wasted"), value: cacheWasted, color: "var(--red)" },
    { key: "subagents", label: t("detail_cost_chart_subagents"), value: subagentsCostUSD, color: "var(--subagent-cost)" },
  ].filter((s) => s.value > 0);

  if (slices.length === 0) return null;

  return (
    <>
      <div className="dash-stack-bar">
        {slices.map((s) => (
          <div key={s.key} className="dash-stack-seg" style={{ flexGrow: s.value, background: s.color }}>
            <span className="dash-stack-tip">{s.label}: {fmtCost(s.value)}</span>
          </div>
        ))}
      </div>
      <div className="dash-donut-legend">
        {slices.map((s) => (
          <div className="dash-donut-row" key={s.key}>
            <span className="dash-donut-swatch" style={{ background: s.color }} />
            <span className="dash-donut-name">{s.label}</span>
            <span className="dash-donut-val cost">{fmtCost(s.value)}</span>
          </div>
        ))}
      </div>
    </>
  );
}
