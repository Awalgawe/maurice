import { useEffect, useMemo, useState } from "react";
import type { PlanEntry } from "../types";
import { deletePlan, getPlans, renamePlan } from "../api";
import { useT } from "../hooks/useT";
import { useFmt } from "../hooks/useFmt";
import { Picker } from "../components/ui/Picker";
import { Md } from "../components/message/Markdown";

type GroupBy = "date" | "folder" | "ticket";
const GROUP_BYS: GroupBy[] = ["date", "folder", "ticket"];

function ScopeBadge({ scope }: { scope: PlanEntry["scope"] }) {
  const t = useT();
  const color = scope === "global" ? "var(--accent)" : "var(--green)";
  return (
    <span className="chip" style={{ color, borderColor: color + "55" }}>
      {scope === "global" ? t("plans_scope_global") : t("plans_scope_project")}
    </span>
  );
}

interface PlanGroup {
  key: string;
  label: string;
  order: number;
  plans: PlanEntry[];
}

export default function Plans() {
  const t = useT();
  const { fmtDate } = useFmt();
  const [plans, setPlans] = useState<PlanEntry[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [project, setProject] = useState("");
  const [scope, setScope] = useState("");
  const [groupBy, setGroupBy] = useState<GroupBy>("date");
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [confirming, setConfirming] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Bodies render ReactMarkdown + syntax highlighting — expensive. Render a
  // plan's body only while its <details> is open, so the (default) collapsed
  // list and every regroup stay cheap. Open state survives regrouping.
  function setOpenState(key: string, isOpen: boolean) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (isOpen) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function reload() {
    getPlans().then(setPlans).catch((e) => setErr(String(e)));
  }
  useEffect(reload, []);

  const projectOpts = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of plans) seen.set(p.projectId, p.projectLabel);
    return [...seen.entries()].map(([v, l]) => ({ v, l }));
  }, [plans]);

  const scopeOpts = useMemo(
    () => [
      { v: "global", l: t("plans_scope_global") },
      { v: "project", l: t("plans_scope_project") },
    ],
    [t],
  );

  const rows = useMemo(
    () =>
      plans.filter((p) => {
        if (project && p.projectId !== project) return false;
        if (scope && p.scope !== scope) return false;
        return true;
      }),
    [plans, project, scope],
  );

  const groups = useMemo<PlanGroup[]>(() => {
    // Rolling time windows from the start of today (used by the "date" pivot).
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const DAY = 86_400_000;
    const dateBucket = (ms: number): { key: string; label: string; order: number } => {
      if (ms >= startToday) return { key: "today", label: t("plans_date_today"), order: 0 };
      if (ms >= startToday - DAY) return { key: "yesterday", label: t("plans_date_yesterday"), order: 1 };
      if (ms >= startToday - 7 * DAY) return { key: "week", label: t("plans_date_week"), order: 2 };
      if (ms >= startToday - 30 * DAY) return { key: "month", label: t("plans_date_month"), order: 3 };
      return { key: "older", label: t("plans_date_older"), order: 4 };
    };

    const map = new Map<string, PlanGroup>();
    for (const p of rows) {
      let key: string, label: string, order: number;
      if (groupBy === "date") {
        ({ key, label, order } = dateBucket(p.mtimeMs));
      } else if (groupBy === "folder") {
        key = p.projectId;
        label = p.projectLabel;
        order = p.scope === "global" ? -1 : 0; // global first, then projects alpha by label
      } else {
        // ticket
        key = p.ticket ?? "__none__";
        label = p.ticket ?? t("plans_no_ticket");
        order = p.ticket ? 0 : 1; // real tickets first, "(no ticket)" last
      }
      let g = map.get(key);
      if (!g) map.set(key, (g = { key, label, order, plans: [] }));
      g.plans.push(p);
    }
    return [...map.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
  }, [rows, groupBy, t]);

  async function handleDelete(p: PlanEntry) {
    try {
      await deletePlan(p.scope, p.projectId, p.filename);
      setPlans((prev) => prev.filter((e) => !(e.projectId === p.projectId && e.filename === p.filename)));
    } catch (e) {
      setErr(String(e));
    } finally {
      setConfirming(null);
    }
  }

  async function handleRename(p: PlanEntry) {
    const newName = renameValue.trim();
    setRenaming(null);
    if (!newName || newName === p.filename) return;
    try {
      await renamePlan(p.scope, p.projectId, p.filename, newName);
      reload(); // the derived title/kind/ticket may change with the filename
    } catch (e) {
      setErr(String(e));
    }
  }

  function renderPlan(p: PlanEntry) {
    const key = `${p.projectId}/${p.filename}`;
    const isConfirming = confirming === key;
    const isRenaming = renaming === key;
    const isOpen = open.has(key);
    return (
      <details
        key={key}
        className="msg"
        open={isOpen}
        onToggle={(e) => setOpenState(key, e.currentTarget.open)}
      >
        <summary className="head" style={{ cursor: "pointer", userSelect: "none" }}>
          <ScopeBadge scope={p.scope} />
          <span style={{ color: "var(--muted)", fontSize: 12 }}>{p.projectLabel}</span>
          <span className="topbar-sep" />
          <span style={{ color: "var(--muted)", fontSize: 12 }}>{fmtDate(new Date(p.mtimeMs).toISOString())}</span>
          {p.ticket && (
            <span className="chip" style={{ fontSize: 11, color: "var(--accent)", borderColor: "var(--accent)55" }}>
              {p.ticket}
            </span>
          )}
          <span style={{ fontWeight: 600, color: "var(--text)", fontSize: 13 }}>{p.title}</span>
          <span style={{ flex: 1 }} />
          {isRenaming ? (
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                autoFocus
                value={renameValue}
                placeholder={t("plans_rename_placeholder")}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); void handleRename(p); }
                  if (e.key === "Escape") { e.preventDefault(); setRenaming(null); }
                }}
                style={{ fontSize: 12, width: 180 }}
              />
              <button
                style={{ fontSize: 12, color: "var(--green)" }}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); void handleRename(p); }}
              >
                {t("plans_rename_confirm")}
              </button>
              <button
                style={{ fontSize: 12 }}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setRenaming(null); }}
              >
                {t("plans_rename_cancel")}
              </button>
            </span>
          ) : isConfirming ? (
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("plans_confirm_sure")}</span>
              <button
                style={{ fontSize: 12, color: "var(--red)" }}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); void handleDelete(p); }}
              >
                {t("plans_confirm_delete")}
              </button>
              <button
                style={{ fontSize: 12 }}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirming(null); }}
              >
                {t("plans_confirm_cancel")}
              </button>
            </span>
          ) : (
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                style={{ fontSize: 12, color: "var(--muted)", opacity: 0.6 }}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setRenameValue(p.filename); setRenaming(key); }}
              >
                {t("plans_rename_btn")}
              </button>
              <button
                style={{ fontSize: 12, color: "var(--muted)", opacity: 0.6, lineHeight: 1 }}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirming(key); }}
              >
                {t("plans_delete_btn")}
              </button>
            </span>
          )}
        </summary>
        {isOpen && (
          <div className="body" style={{ padding: "12px 16px", fontSize: 13, lineHeight: 1.6 }}>
            <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 8 }}>{p.filename}</div>
            <Md>{p.body}</Md>
          </div>
        )}
      </details>
    );
  }

  return (
    <div>
      <div className="controls">
        <Picker label={t("plans_filter_project")} value={project} set={setProject} opts={projectOpts} />
        <Picker label={t("plans_filter_scope")} value={scope} set={setScope} opts={scopeOpts} />
        <span className="topbar-sep" />
        <span className="muted" style={{ fontSize: 13 }}>{t("plans_group_label")}</span>
        {GROUP_BYS.map((g) => (
          <button key={g} className={groupBy === g ? "active" : ""} onClick={() => setGroupBy(g)}>
            {t(`plans_group_${g}` as const)}
          </button>
        ))}
        <span style={{ color: "var(--muted)", fontSize: 13 }}>
          {rows.length} {rows.length === 1 ? t("plans_count_one") : t("plans_count_many")}
        </span>
      </div>

      {err && <p style={{ color: "var(--red)" }}>{err}</p>}

      {groups.map((g) => (
        <div key={g.key}>
          <div
            style={{
              margin: "18px 0 8px",
              paddingBottom: 4,
              borderBottom: "1px solid var(--border)",
              color: "var(--muted)",
              fontSize: 12,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: 0.4,
              display: "flex",
              gap: 8,
            }}
          >
            <span>{g.label}</span>
            <span style={{ opacity: 0.6 }}>{g.plans.length}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>{g.plans.map(renderPlan)}</div>
        </div>
      ))}
    </div>
  );
}
