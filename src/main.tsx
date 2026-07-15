import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import "./index.css";
import "highlight.js/styles/atom-one-dark.css";
import Dashboard from "./pages/Dashboard";
import Sessions from "./pages/Sessions";
import SessionDetail from "./pages/SessionDetail";
import SubagentDetailPage from "./pages/SubagentDetailPage";
import Workflow from "./pages/Workflow";
import Timeline from "./pages/Timeline";
import Memories from "./pages/Memories";
import Plans from "./pages/Plans";
import Hooks from "./pages/Hooks";
import Agents from "./pages/Agents";
import Mcp from "./pages/Mcp";
import Bilans from "./pages/Bilans";
import { EditorProvider } from "./state/EditorContext";
import { LangProvider } from "./state/LangContext";
import { ThemeProvider } from "./state/ThemeContext";
import { Topbar } from "./components/layout/Topbar";

// The Dashboard renders full-width; every other route stays capped by `.content`.
function Main() {
  const { pathname } = useLocation();
  const full = pathname === "/";
  return (
    <main className={full ? "content content--full" : "content"}>
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
    </main>
  );
}

function App() {
  return (
    <ThemeProvider>
    <LangProvider>
    <EditorProvider>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
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
