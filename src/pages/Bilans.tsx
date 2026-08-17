import { useEffect, useState } from "react";
import type { BilanDetail, BilanMeta } from "../types";
import { getBilans, getBilan } from "../api";
import { useT } from "../hooks/useT";
import { useFmt } from "../hooks/useFmt";
import { Md } from "../components/message/Markdown";
import { useTheme, type Theme } from "../state/ThemeContext";

/** The bilan template resolves its palette from `data-theme` on <html>, falling
 *  back to prefers-color-scheme. A sandboxed frame has an opaque origin, so we
 *  can't reach into it: the attribute is stamped into the source instead, or a
 *  bilan lands dark inside a light Maurice. Its own toggle still works. */
function withMauriceTheme(html: string, theme: Theme): string {
  const mode = theme === "maurice" ? "light" : "dark";
  return html.replace(/<html\b([^>]*)>/i, (tag, attrs: string) =>
    /\bdata-theme=/i.test(attrs) ? tag : `<html${attrs} data-theme="${mode}">`
  );
}

function PeriodLabel({ bilan }: { bilan: BilanMeta }) {
  const { fmtDate } = useFmt();
  if (bilan.periodStart && bilan.periodEnd) {
    return (
      <span style={{ color: "var(--muted)", fontSize: 12 }}>
        {fmtDate(bilan.periodStart)} → {fmtDate(bilan.periodEnd)}
      </span>
    );
  }
  return (
    <span style={{ color: "var(--muted)", fontSize: 12 }}>{bilan.date}</span>
  );
}

function BilanBody({ bilan }: { bilan: BilanMeta }) {
  const { theme } = useTheme();
  const [detail, setDetail] = useState<BilanDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    getBilan(bilan.id)
      .then(setDetail)
      .catch((e) => setErr(String(e)));
  }, [bilan.id]);

  if (err) return <p style={{ color: "var(--red)", fontSize: 13 }}>{err}</p>;
  if (!detail) return <p style={{ color: "var(--muted)", fontSize: 13 }}>…</p>;

  // An HTML bilan is a whole document with its own stylesheet: it goes in a
  // frame with an opaque origin, so its scripts (theme toggle, copy buttons)
  // still run but can't reach Maurice's DOM, storage or cookies.
  if (detail.format === "html") {
    return (
      <iframe
        title={detail.title}
        srcDoc={withMauriceTheme(detail.body, theme)}
        sandbox="allow-scripts"
        style={{
          display: "block",
          width: "100%",
          height: "70vh",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-sm)",
          background: "var(--bg)",
        }}
      />
    );
  }

  return (
    <div style={{ fontSize: 13, lineHeight: 1.7 }}>
      <Md>{detail.body}</Md>
    </div>
  );
}

function BilanRow({ bilan }: { bilan: BilanMeta }) {
  const t = useT();
  const { fmtCost } = useFmt();
  // <details> keeps its children mounted when closed, so the body is only
  // rendered once opened — otherwise every HTML bilan (~50 kB) would be
  // fetched and framed on page load.
  const [opened, setOpened] = useState(false);

  return (
    <details
      className="msg"
      onToggle={(e) => {
        if (e.currentTarget.open) setOpened(true);
      }}
    >
      <summary className="head" style={{ cursor: "pointer", userSelect: "none" }}>
        <span
          className="chip"
          style={{ color: "var(--accent)", borderColor: "color-mix(in srgb, var(--accent) 33%, transparent)", fontFamily: "var(--mono)", fontSize: 11 }}
        >
          {bilan.date}
        </span>
        <span style={{ fontWeight: 600, color: "var(--text)", fontSize: 13 }}>{bilan.title}</span>
        <span className="topbar-sep" />
        <PeriodLabel bilan={bilan} />
        {bilan.sessions !== null && (
          <>
            <span className="topbar-sep" />
            <span style={{ color: "var(--muted)", fontSize: 12 }}>
              {bilan.sessions} {t("bilans_sessions")}
            </span>
          </>
        )}
        {bilan.costUSD !== null && (
          <>
            <span className="topbar-sep" />
            <span style={{ color: "var(--green)", fontSize: 12 }}>
              {fmtCost(bilan.costUSD)} {t("bilans_cost")}
            </span>
          </>
        )}
      </summary>
      <div className="body" style={{ padding: "12px 16px" }}>
        {opened && <BilanBody bilan={bilan} />}
      </div>
    </details>
  );
}

export default function Bilans() {
  const t = useT();
  const [bilans, setBilans] = useState<BilanMeta[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    getBilans().then(setBilans).catch((e) => setErr(String(e)));
  }, []);

  return (
    <div>
      <div className="controls">
        <span style={{ color: "var(--muted)", fontSize: 13 }}>
          {bilans.length} {bilans.length === 1 ? t("bilans_count_one") : t("bilans_count_many")}
        </span>
      </div>

      {err && <p style={{ color: "var(--red)" }}>{err}</p>}

      {bilans.length === 0 && !err && (
        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 24 }}>{t("bilans_empty")}</p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {bilans.map((b) => (
          <BilanRow key={b.id} bilan={b} />
        ))}
      </div>
    </div>
  );
}
