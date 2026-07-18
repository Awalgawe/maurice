import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import "./index.css";
import "highlight.js/styles/atom-one-dark.css";
import { EditorProvider } from "./state/EditorContext";
import { LangProvider } from "./state/LangContext";
import { ThemeProvider } from "./state/ThemeContext";
import { Topbar } from "./components/layout/Topbar";
import { useT } from "./hooks/useT";

// Pages are code-split per route so the initial bundle stays small; each chunk
// loads on first navigation to its route.
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Sessions = lazy(() => import("./pages/Sessions"));
const SessionDetail = lazy(() => import("./pages/SessionDetail"));
const SubagentDetailPage = lazy(() => import("./pages/SubagentDetailPage"));
const Workflow = lazy(() => import("./pages/Workflow"));
const Timeline = lazy(() => import("./pages/Timeline"));
const Memories = lazy(() => import("./pages/Memories"));
const Plans = lazy(() => import("./pages/Plans"));
const Hooks = lazy(() => import("./pages/Hooks"));
const Agents = lazy(() => import("./pages/Agents"));
const Mcp = lazy(() => import("./pages/Mcp"));
const Bilans = lazy(() => import("./pages/Bilans"));

function PageFallback() {
  const t = useT();
  return <div className="center">{t("app_loading")}</div>;
}

// The Dashboard renders full-width; every other route stays capped by `.content`.
function Main() {
  const { pathname } = useLocation();
  const full = pathname === "/";
  return (
    <main className={full ? "content content--full" : "content"}>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/sessions" element={<Sessions />} />
          <Route path="/sessions/:id" element={<SessionDetail />} />
          <Route path="/sessions/:id/subagents/:ref" element={<SubagentDetailPage />} />
          <Route path="/workflow" element={<Workflow />} />
          <Route path="/timeline" element={<Timeline />} />
          <Route path="/memories" element={<Memories />} />
          <Route path="/plans" element={<Plans />} />
          <Route path="/hooks" element={<Hooks />} />
          <Route path="/agents" element={<Agents />} />
          <Route path="/mcp" element={<Mcp />} />
          <Route path="/bilans" element={<Bilans />} />
        </Routes>
      </Suspense>
    </main>
  );
}

function App() {
  return (
    <ThemeProvider>
    <LangProvider>
    <EditorProvider>
      <BrowserRouter>
        <div className="app">
          <Topbar />
          <Main />
        </div>
      </BrowserRouter>
    </EditorProvider>
    </LangProvider>
    </ThemeProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
