import { NavLink } from "react-router-dom";
import { ConfigOverlay } from "./ConfigOverlay";
import { useT } from "../../hooks/useT";
import { useFmt } from "../../hooks/useFmt";
import { useActiveSession, fmtElapsed } from "../../hooks/useActiveSession";
import { totalTokens, modelLabel } from "../../format";

/** Sticky top bar: brand + nav + live indicator + config overlay trigger. */
export function Topbar() {
  const t = useT();
  const { fmtCost, fmtTokens } = useFmt();
  const active = useActiveSession();
  return (
    <header className={active ? "topbar topbar--live" : "topbar"}>
      <div className="brand">
        <img src="/favicon.png" className="brand-icon" aria-hidden="true" />
        Maurice
      </div>
      <div className="topbar-sep" />
      <nav className="nav">
        <NavLink to="/" end>{t("nav_dashboard")}</NavLink>
        <NavLink to="/sessions">{t("nav_sessions")}</NavLink>
        <NavLink to="/workflow">{t("nav_workflow")}</NavLink>
        <NavLink to="/timeline">{t("nav_timeline")}</NavLink>
        <NavLink to="/memories">{t("nav_memories")}</NavLink>
        <NavLink to="/plans">{t("nav_plans")}</NavLink>
        <NavLink to="/hooks">{t("nav_hooks")}</NavLink>
        <NavLink to="/agents">{t("nav_agents")}</NavLink>
        <NavLink to="/mcp">{t("nav_mcp")}</NavLink>
        <NavLink to="/bilans">{t("nav_bilans")}</NavLink>
      </nav>
      <div className="spacer" />
      {active && (
        <>
          <div className="topbar-live">
            <span className="live-dot" />
            <span className="live-label">{active.sessionCount > 1 ? String(active.sessionCount) + " " : ""}{t("live_label")}</span>
            <span className="live-sep" />
            <span className="live-project">
              {active.sessionCount > 1 ? t("live_multiple") : active.projectPath.split("/").slice(-2).join("/")}
            </span>
            <span className="live-sep live-extra" />
            <span className="live-stat live-extra">{fmtElapsed(active.elapsedMs)}</span>
            <span className="live-sep live-extra" />
            <span className="live-stat live-extra">{fmtTokens(totalTokens(active.tokens))}</span>
            <span className="live-sep" />
            <span className="live-stat" style={{ color: "var(--green)" }}>{fmtCost(active.estCostUSD)}</span>
            {active.model && (
              <>
                <span className="live-sep live-extra" />
                <span className="live-stat live-extra" style={{ color: "var(--chip-model-color)" }}>{modelLabel(active.model)}</span>
              </>
            )}
          </div>
          <div className="topbar-sep" />
        </>
      )}
      <ConfigOverlay />
    </header>
  );
}
