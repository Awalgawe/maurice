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

  if (context.length <= 1) return <div className="muted">{t("detail_ctx_empty")}</div>;

  return (
    <>
      <ResponsiveContainer width="100%" height={140}>
        <AreaChart data={context} margin={{ top: 5, right: 5, bottom: 0, left: -20 }}>
          <CartesianGrid stroke="#2a2f3a" vertical={false} />
          <XAxis dataKey="t" tick={false} stroke="#2a2f3a" />
          <YAxis domain={[0, 100]} tick={{ fill: "#8a91a0", fontSize: 11 }} stroke="#2a2f3a" />
          <Tooltip
            contentStyle={{ background: "#1e222b", border: "1px solid #2a2f3a", borderRadius: 6 }}
            labelFormatter={(v) => fmtDate(String(v))}
            formatter={(v: number, _name, item: { payload?: { model?: string | null } }) => [
              `${v.toFixed(0)}%${item?.payload?.model ? ` — ${item.payload.model}` : ""}`,
              t("detail_chart_tooltip"),
            ]}
          />
          <ReferenceLine y={80} stroke="#fbbf24" strokeDasharray="4 4" />
          {compactions.map((c, i) => (
            <ReferenceLine
              key={`compact-${c.t || i}`}
              x={c.t}
              stroke="#fbbf24"
              strokeDasharray="4 3"
              label={{
                value: t("detail_ctx_compact_label"),
                fill: "#fbbf24",
                fontSize: 10,
                position: "insideBottomRight",
              }}
            />
          ))}
          {modelChanges.map((c) => (
            <ReferenceLine
              key={c.t}
              x={c.t}
              stroke="#c084fc"
              strokeDasharray="4 4"
              label={{
                value: c.model.replace(/^claude-/, ""),
                fill: "#c084fc",
                fontSize: 10,
                position: "insideTopRight",
              }}
            />
          ))}
          <Area type="monotone" dataKey="pct" stroke="#6ea8fe" fill="#6ea8fe33" isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
      <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
        {t("detail_ctx_hint")}
      </div>
    </>
  );
}
