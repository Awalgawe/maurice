/** Horizontal fill bar for context-window usage (turns red past 75%). */
export function ContextBar({ pct }: { pct: number }) {
  return (
    <div className={"bar" + (pct >= 75 ? " high" : "")} title={`${pct.toFixed(0)}%`}>
      <span style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );
}
