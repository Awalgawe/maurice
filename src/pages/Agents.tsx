import { useEffect, useMemo, useState } from "react";
import type { AgentDefinition, AgentOrigin, AgentRow } from "../types";
import { getAgents } from "../api";
import { useT } from "../hooks/useT";
import { useFmt } from "../hooks/useFmt";
import { useSortable } from "../hooks/useSortable";
import { editorLabel, useEditor } from "../state/EditorContext";
import { Picker } from "../components/ui/Picker";
import { SortHeader } from "../components/ui/SortHeader";
import { totalTokens } from "../format";

type SortKey = "name" | "runs" | "sessions" | "costUSD" | "lastUsed";

const ORIGIN_COLOR: Record<AgentOrigin, string> = {
  builtin: "var(--accent)",
  custom: "var(--green)",
  plugin: "var(--accent-2)",
  unknown: "var(--amber)",
};

function originLabel(t: ReturnType<typeof useT>, origin: AgentOrigin): string {
  switch (origin) {
    case "builtin": return t("agents_origin_builtin");
    case "custom": return t("agents_origin_custom");
    case "plugin": return t("agents_origin_plugin");
    default: return t("agents_origin_unknown");
  }
}

function OriginBadge({ origin }: { origin: AgentOrigin }) {
  const t = useT();
  const color = ORIGIN_COLOR[origin];
  return (
    <span className="chip" style={{ color, borderColor: `color-mix(in srgb, ${color} 33%, transparent)` }}>
      {originLabel(t, origin)}
    </span>
  );
}

function sourceLabel(t: ReturnType<typeof useT>, source: AgentDefinition["source"]): string {
  switch (source) {
    case "user": return t("agents_source_user");
    case "project": return t("agents_source_project");
    default: return t("agents_source_plugin");
  }
}

/** One line per definition: source (+ project label when relevant), model, tool
 *  count, and the file path with an "open in <editor>" affordance — same
 *  pattern as the chat thread's <ide_opened_file> tag (systemTags.tsx). */
function DefinitionLine({ def }: { def: AgentDefinition }) {
  const t = useT();
  const { editor } = useEditor();
  const label = editorLabel(editor, t);
  const openTitle = t("editor_open_in", { editor: label });
  const bits = [
    sourceLabel(t, def.source) + (def.source === "project" && def.projectLabel ? ` (${def.projectLabel})` : ""),
    def.model,
    def.tools === null ? t("agents_tools_all") : `${def.tools.length} ${t("agents_tools_count")}`,
  ].filter(Boolean);
  return (
    <div className="muted" style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <span>{bits.join(" · ")}</span>
      <span>·</span>
      <code style={{ fontSize: 10 }}>{def.filePath}</code>
      {editor.url ? (
        <a className="ide-file-open" href={editor.url(def.filePath)} title={openTitle}>
          {label}
        </a>
      ) : (
        <button
          className="ide-file-open"
          title={openTitle}
          onClick={() =>
            fetch("/api/open", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ path: def.filePath }),
            })
          }
        >
          {label}
        </button>
      )}
    </div>
  );
}

export default function Agents() {
  const t = useT();
  const { fmtCost, fmtAgo, fmtTokens } = useFmt();
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [origin, setOrigin] = useState("");
  const { sortKey, sortDir, toggle, sortBy } = useSortable<SortKey>("costUSD", -1);

  useEffect(() => {
    getAgents()
      .then((a) => { setAgents(a); setLoaded(true); })
      .catch((e) => setErr(String(e)));
  }, []);

  const originOpts = useMemo(
    () =>
      (["builtin", "custom", "plugin", "unknown"] as AgentOrigin[]).map((o) => ({ v: o, l: originLabel(t, o) })),
    [t],
  );

  const filtered = useMemo(
    () => agents.filter((a) => !origin || a.origin === origin),
    [agents, origin],
  );

  const rows = useMemo(
    () =>
      sortBy(filtered, (a) => {
        switch (sortKey) {
          case "name": return a.name;
          case "runs": return a.usage?.runs ?? 0;
          case "sessions": return a.usage?.sessions ?? 0;
          case "lastUsed": return a.usage?.lastUsed ?? "";
          default: return a.usage?.costUSD ?? 0;
        }
      }),
    [filtered, sortKey, sortBy],
  );

  const sortProps = { active: sortKey, dir: sortDir, onSort: toggle };

  return (
    <div>
      <div className="controls">
        <Picker label={t("agents_filter_origin")} value={origin} set={setOrigin} opts={originOpts} />
        <span className="hint">{rows.length} {rows.length === 1 ? t("agents_count_one") : t("agents_count_many")}</span>
      </div>

      {err && <p style={{ color: "var(--red)" }}>{t("agents_error")}</p>}
      {!err && loaded && rows.length === 0 && <p style={{ color: "var(--muted)" }}>{t("agents_empty")}</p>}
      {!err && !loaded && <p style={{ color: "var(--muted)" }}>{t("agents_loading")}</p>}

      {rows.length > 0 && (
        <table>
          <thead>
            <tr>
              <SortHeader k="name" label={t("agents_col_name")} {...sortProps} />
              <SortHeader k="runs" label={t("agents_col_runs")} className="num" {...sortProps} />
              <SortHeader k="sessions" label={t("agents_col_sessions")} className="num" {...sortProps} />
              <SortHeader k="costUSD" label={t("agents_col_cost")} className="num" {...sortProps} />
              <SortHeader k="lastUsed" label={t("agents_col_last_used")} {...sortProps} />
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => {
              const orphanDefined = a.definitions.length > 0 && !a.usage;
              const orphanUsed = a.definitions.length === 0 && !!a.usage;
              return (
                <tr key={a.name}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <strong>{a.name}</strong>
                      <OriginBadge origin={a.origin} />
                      {orphanDefined && (
                        <span className="chip warn">{t("agents_never_used")}</span>
                      )}
                    </div>
                    {a.definitions.length > 0 ? (
                      <>
                        <div className="muted" style={{ fontSize: 12, maxWidth: 640 }}>
                          {a.definitions[0].description}
                        </div>
                        {a.definitions.map((d, i) => <DefinitionLine key={i} def={d} />)}
                      </>
                    ) : (
                      orphanUsed && (
                        <div className="muted" style={{ fontSize: 12, fontStyle: "italic" }}>
                          {t("agents_no_definition")}
                        </div>
                      )
                    )}
                  </td>
                  <td className="num">{a.usage?.runs ?? "—"}</td>
                  <td className="num">{a.usage?.sessions ?? "—"}</td>
                  <td className="num" title={a.usage ? fmtTokens(totalTokens(a.usage.tokens)) : undefined}>
                    {a.usage ? fmtCost(a.usage.costUSD) : "—"}
                  </td>
                  <td className="date">{a.usage?.lastUsed ? fmtAgo(a.usage.lastUsed) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
