import { NavLink } from "react-router-dom";
import { EditorSelect } from "./EditorSelect";
import { LangSelect } from "./LangSelect";
import { ThemeSelect } from "./ThemeSelect";
import { useT } from "../../hooks/useT";
import { useFmt } from "../../hooks/useFmt";
import { useActiveSession, fmtElapsed } from "../../hooks/useActiveSession";
import { totalTokens, modelLabel } from "../../format";

/** Sticky top bar: brand + nav + live indicator + editor selector + read-only hint. */
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
        <NavLink to="/" end>Dashboard</NavLink>
        <NavLink to="/sessions">Sessions</NavLink>
        <NavLink to="/workflow">Workflow</NavLink>
        <NavLink to="/timeline">Timeline</NavLink>
        <NavLink to="/memories">Memories</NavLink>
        <NavLink to="/plans">Plans</NavLink>
        <NavLink to="/hooks">Hooks</NavLink>
        <NavLink to="/agents">Agents</NavLink>
        <NavLink to="/mcp">MCP</NavLink>
        <NavLink to="/bilans">Bilans</NavLink>
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
      <div className="topbar-tools">
        <EditorSelect />
        <LangSelect />
        <ThemeSelect />
      </div>
      <div className="topbar-sep" />
      <div className="hint">{t("hint_readonly")}</div>
    </header>
  );
}
