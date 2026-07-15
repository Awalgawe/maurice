import { Fragment, useEffect, useRef, useState } from "react";
import type { TokenTotals } from "../types";
import { totalTokens } from "../format";
import { useFmt } from "../hooks/useFmt";
import { useT } from "../hooks/useT";

/** At-a-glance stacked bar + table of where a node's (session or subagent)
 *  estimated cost actually goes: input/output/cache-read/cache-write,
 *  cache-write split into its avoidable-rewrite waste vs. the rest, and the
 *  node's own subagents' share. Caller wraps it in a Panel — used inside
 *  "Cost & tokens" for both the session root and any subagent detail (same
 *  shape either way). */
export function CostBreakdownChart({
  costByComponent,
  tokensByComponent,
  cacheRewriteWastedUSD,
  cacheRewriteWastedTokens,
  subagentsCostUSD,
  subagentsTokens,
  estCostUSD,
  withSubagentsCostUSD,
}: {
  costByComponent: TokenTotals;
  tokensByComponent: TokenTotals;
  cacheRewriteWastedUSD: number;
  cacheRewriteWastedTokens: number;
  subagentsCostUSD: number;
  subagentsTokens?: TokenTotals;
  estCostUSD: number;
  // Own cost + every descendant subagent's — present only when it exceeds
  // estCostUSD (i.e. the node actually has subagents).
  withSubagentsCostUSD?: number;
}) {
  const t = useT();
  const { fmtCost, fmtTokens } = useFmt();
  const [hovered, setHovered] = useState<string | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (leaveTimer.current) clearTimeout(leaveTimer.current); }, []);

  const cacheWastedCost = Math.min(cacheRewriteWastedUSD, costByComponent.cacheCreate);
  const cacheRegularCost = Math.max(0, costByComponent.cacheCreate - cacheWastedCost);
  const cacheWastedTokens = Math.min(cacheRewriteWastedTokens, tokensByComponent.cacheCreate);
  const cacheRegularTokens = Math.max(0, tokensByComponent.cacheCreate - cacheWastedTokens);

  const slices = [
    { key: "input", label: t("detail_token_input"), value: costByComponent.input, tokens: tokensByComponent.input, color: "var(--accent)" },
    { key: "output", label: t("detail_token_output"), value: costByComponent.output, tokens: tokensByComponent.output, color: "var(--accent-2)" },
    { key: "cacheRead", label: t("detail_token_cache_read"), value: costByComponent.cacheRead, tokens: tokensByComponent.cacheRead, color: "var(--green)" },
    { key: "cacheWrite", label: t("detail_token_cache_write"), value: cacheRegularCost, tokens: cacheRegularTokens, color: "var(--amber)" },
    { key: "cacheWasted", label: t("detail_cost_chart_wasted"), value: cacheWastedCost, tokens: cacheWastedTokens, color: "var(--red)" },
    { key: "subagents", label: t("detail_cost_chart_subagents"), value: subagentsCostUSD, tokens: subagentsTokens ? totalTokens(subagentsTokens) : 0, color: "var(--subagent-cost)" },
  ].filter((s) => s.value > 0);

  if (slices.length === 0) return null;

  const ownTokensTotal = totalTokens(tokensByComponent);
  const subagentsTokensTotal = subagentsTokens ? totalTokens(subagentsTokens) : 0;
  const coreSlices = slices.filter((s) => s.key !== "subagents");
  const subagentsSlice = slices.find((s) => s.key === "subagents");

  const total = slices.reduce((sum, s) => sum + s.value, 0);
  let cursor = 0;
  const anchors = slices.map((s) => {
    const left = (cursor / total) * 100;
    cursor += s.value;
    return { ...s, left, width: (s.value / total) * 100 };
  });

  // Bar segments and table rows sharing a slice key mutually highlight on
  // hover — dim everything else instead of drawing a border (the bar has no
  // gaps to draw one in, and the table cells are separate grid items).
  // The leave is debounced: adjacent cells/segments are separated by a grid
  // gap, so the pointer briefly hovers nothing when crossing it — clearing
  // hover instantly flashes every row back to full opacity for a frame.
  const dim = (key: string) => (hovered !== null && hovered !== key ? 0.45 : 1);
  const rowHover = (key: string) => ({
    onMouseEnter: () => {
      if (leaveTimer.current) clearTimeout(leaveTimer.current);
      setHovered(key);
    },
    onMouseLeave: () => {
      if (leaveTimer.current) clearTimeout(leaveTimer.current);
      leaveTimer.current = setTimeout(() => setHovered((h) => (h === key ? null : h)), 60);
    },
  });

  return (
    <>
      <div className="dash-stack-bar-wrap">
        <div className="dash-stack-bar">
          {slices.map((s) => (
            <div key={s.key} style={{ flexGrow: s.value, background: s.color, opacity: dim(s.key), transition: "opacity .15s" }} />
          ))}
        </div>
        {anchors.map((s) => (
          <div
            key={s.key}
            className="dash-stack-tip-anchor"
            style={{ left: `${s.left}%`, width: `${s.width}%` }}
            {...rowHover(s.key)}
          >
            <span className="dash-stack-tip">{s.label}: {fmtCost(s.value)}</span>
          </div>
        ))}
      </div>
      <div className="dash-cost-table">
        {coreSlices.map((s) => (
          <Fragment key={s.key}>
            <span className="dash-cost-swatch" style={{ opacity: dim(s.key) }} {...rowHover(s.key)}>
              <span className="dash-cost-dot" style={{ background: s.color }} />
            </span>
            <span className="dash-cost-name" style={{ opacity: dim(s.key) }} {...rowHover(s.key)}>{s.label}</span>
            <span className="dash-cost-tokens" style={{ opacity: dim(s.key) }} {...rowHover(s.key)}>{fmtTokens(s.tokens)}</span>
            <span className="dash-cost-cost cost" style={{ opacity: dim(s.key) }} {...rowHover(s.key)}>{fmtCost(s.value)}</span>
          </Fragment>
        ))}
        <span className="dash-cost-swatch dash-cost-bold-cell" />
        <span className="dash-cost-name dash-cost-bold-cell">{t("detail_token_total")}</span>
        <span className="dash-cost-tokens dash-cost-bold-cell">{fmtTokens(ownTokensTotal)}</span>
        <span className="dash-cost-cost cost dash-cost-bold-cell">{fmtCost(estCostUSD)}</span>
        {subagentsSlice && (
          <>
            <span
              className="dash-cost-swatch dash-cost-sep-cell"
              style={{ opacity: dim(subagentsSlice.key) }}
              {...rowHover(subagentsSlice.key)}
            >
              <span className="dash-cost-dot" style={{ background: subagentsSlice.color }} />
            </span>
            <span className="dash-cost-name dash-cost-sep-cell" style={{ opacity: dim(subagentsSlice.key) }} {...rowHover(subagentsSlice.key)}>
              {subagentsSlice.label}
            </span>
            <span className="dash-cost-tokens dash-cost-sep-cell" style={{ opacity: dim(subagentsSlice.key) }} {...rowHover(subagentsSlice.key)}>
              {fmtTokens(subagentsSlice.tokens)}
            </span>
            <span className="dash-cost-cost cost dash-cost-sep-cell" style={{ opacity: dim(subagentsSlice.key) }} {...rowHover(subagentsSlice.key)}>
              {fmtCost(subagentsSlice.value)}
            </span>
          </>
        )}
        {withSubagentsCostUSD !== undefined && (
          <>
            <span className="dash-cost-swatch dash-cost-bold-cell" />
            <span className="dash-cost-name dash-cost-bold-cell">{t("detail_cost_chart_total_with_sub")}</span>
            <span className="dash-cost-tokens dash-cost-bold-cell">{fmtTokens(ownTokensTotal + subagentsTokensTotal)}</span>
            <span className="dash-cost-cost cost dash-cost-bold-cell">{fmtCost(withSubagentsCostUSD)}</span>
          </>
        )}
      </div>
    </>
  );
}
