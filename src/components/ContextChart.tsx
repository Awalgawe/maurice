import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ContextPoint } from "../types";
import { useFmt } from "../hooks/useFmt";
import { useT } from "../hooks/useT";

/** The context-window fill curve, shared by the session detail and the
 *  subagent detail. Caller wraps it in a Panel with its own title. */
export function ContextChart({
  context,
  modelChanges = [],
  compactions = [],
}: {
  context: ContextPoint[];
  modelChanges?: { t: string; model: string }[];
  compactions?: { t: string; trigger?: string }[];
}) {
  const t = useT();
  const { fmtDate } = useFmt();

  // Numeric (epoch-ms) X so the axis is a continuous time scale: on the previous
  // categorical axis a compaction/model-change marker whose timestamp wasn't an
  // exact data-point tick was silently dropped. Points with an unparseable
  // timestamp are excluded so they can't collapse the domain to NaN.
  const data = useMemo(
    () => context.map((p) => ({ ...p, tn: new Date(p.t).getTime() })).filter((p) => Number.isFinite(p.tn)),
    [context],
  );

  if (data.length <= 1) return <div className="muted">{t("detail_ctx_empty")}</div>;

  const markerX = (ts: string): number | null => {
    const n = new Date(ts).getTime();
    return Number.isFinite(n) ? n : null;
  };

  return (
    <>
      <ResponsiveContainer width="100%" height={140}>
        <AreaChart data={data} margin={{ top: 5, right: 5, bottom: 0, left: -20 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="tn" type="number" scale="time" domain={["dataMin", "dataMax"]} tick={false} stroke="var(--border)" />
          <YAxis domain={[0, 100]} tick={{ fill: "var(--muted)", fontSize: 11 }} stroke="var(--border)" />
          <Tooltip
            contentStyle={{ background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 6 }}
            labelFormatter={(v) => fmtDate(new Date(Number(v)).toISOString())}
            formatter={(v, _name, item: { payload?: { model?: string | null } }) => [
              `${Number(v).toFixed(0)}%${item?.payload?.model ? ` — ${item.payload.model}` : ""}`,
              t("detail_chart_tooltip"),
            ]}
          />
          <ReferenceLine y={80} stroke="var(--amber)" strokeDasharray="4 4" />
          {compactions.map((c, i) => {
            const x = markerX(c.t);
            return x === null ? null : (
              <ReferenceLine
                key={`compact-${c.t || i}`}
                x={x}
                stroke="var(--amber)"
                strokeDasharray="4 3"
                label={{
                  value: t("detail_ctx_compact_label"),
                  fill: "var(--amber)",
                  fontSize: 10,
                  position: "insideBottomRight",
                }}
              />
            );
          })}
          {modelChanges.map((c) => {
            const x = markerX(c.t);
            return x === null ? null : (
              <ReferenceLine
                key={c.t}
                x={x}
                stroke="var(--chart-model-change)"
                strokeDasharray="4 4"
                label={{
                  value: c.model.replace(/^claude-/, ""),
                  fill: "var(--chart-model-change)",
                  fontSize: 10,
                  position: "insideTopRight",
                }}
              />
            );
          })}
          <Area type="monotone" dataKey="pct" stroke="var(--accent)" fill="color-mix(in srgb, var(--accent) 20%, transparent)" isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
      <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
        {t("detail_ctx_hint")}
      </div>
    </>
  );
}
