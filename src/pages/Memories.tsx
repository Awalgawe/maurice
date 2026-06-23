import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { MemoryEntry } from "../types";
import { deleteMemory, getMemories } from "../api";
import { useT } from "../hooks/useT";
import { Picker } from "../components/ui/Picker";
import { Md } from "../components/message/Markdown";

const TYPE_COLORS: Record<string, string> = {
  feedback: "var(--accent-2)",
  user: "var(--accent)",
  reference: "var(--green)",
  project: "var(--amber)",
};

function TypeBadge({ type }: { type: string }) {
  const color = TYPE_COLORS[type] ?? "var(--muted)";
  return (
    <span className="chip" style={{ color, borderColor: color + "55" }}>
      {type}
    </span>
  );
}

export default function Memories() {
  const t = useT();
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [project, setProject] = useState("");
  const [type, setType] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);

  useEffect(() => {
    getMemories().then(setMemories).catch((e) => setErr(String(e)));
  }, []);

  const projectOpts = useMemo(() => {
    const seen = new Map<string, string>();
    for (const m of memories) seen.set(m.projectId, m.projectLabel);
    return [...seen.entries()].map(([v, l]) => ({ v, l }));
  }, [memories]);

  const typeOpts = useMemo(() => {
    const seen = new Set<string>();
    for (const m of memories) seen.add(m.type);
    return [...seen].sort().map((v) => ({ v, l: v }));
  }, [memories]);

  const rows = useMemo(
    () =>
      memories.filter((m) => {
        if (project && m.projectId !== project) return false;
        if (type && m.type !== type) return false;
        return true;
      }),
    [memories, project, type],
  );

  async function handleDelete(m: MemoryEntry) {
    try {
      await deleteMemory(m.projectId, m.filename);
      setMemories((prev) => prev.filter((e) => !(e.projectId === m.projectId && e.filename === m.filename)));
    } catch (e) {
      setErr(String(e));
    } finally {
      setConfirming(null);
    }
  }

  return (
    <div>
      <div className="controls">
        <Picker label={t("memories_filter_project")} value={project} set={setProject} opts={projectOpts} />
        <Picker label={t("memories_filter_type")} value={type} set={setType} opts={typeOpts} />
        <span style={{ color: "var(--muted)", fontSize: 13 }}>
          {rows.length} {rows.length === 1 ? t("memories_count_one") : t("memories_count_many")}
        </span>
      </div>

      {err && <p style={{ color: "var(--red)" }}>{err}</p>}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {rows.map((m) => {
          const key = `${m.projectId}/${m.filename}`;
          const isConfirming = confirming === key;
          return (
            <details key={key} className="msg">
              <summary className="head" style={{ cursor: "pointer", userSelect: "none" }}>
                <TypeBadge type={m.type} />
                <span style={{ color: "var(--muted)", fontSize: 12 }}>{m.projectLabel}</span>
                <span className="topbar-sep" />
                <span style={{ fontWeight: 600, color: "var(--text)", fontSize: 13 }}>
                  {m.description || m.name}
                </span>
                <span style={{ flex: 1 }} />
                {isConfirming ? (
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("memories_confirm_sure")}</span>
                    <button
                      style={{ fontSize: 12, color: "var(--red)" }}
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); void handleDelete(m); }}
                    >
                      {t("memories_confirm_delete")}
                    </button>
                    <button
                      style={{ fontSize: 12 }}
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirming(null); }}
                    >
                      {t("memories_confirm_cancel")}
                    </button>
                  </span>
                ) : (
                  <button
                    style={{ fontSize: 12, color: "var(--muted)", opacity: 0.6, lineHeight: 1 }}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirming(key); }}
                  >
                    {t("memories_delete_btn")}
                  </button>
                )}
              </summary>
              <div className="body" style={{ padding: "12px 16px", fontSize: 13, lineHeight: 1.6 }}>
                <Md>{m.body}</Md>
                {m.originSessionId && (
                  <div style={{ marginTop: 10, fontSize: 12 }}>
                    <Link to={`/sessions/${m.originSessionId}`} className="muted">
                      {t("memories_origin_link")}
                    </Link>
                  </div>
                )}
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}
