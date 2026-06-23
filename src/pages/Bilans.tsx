import { useEffect, useState } from "react";
import type { BilanDetail, BilanMeta } from "../types";
import { getBilans, getBilan } from "../api";
import { useT } from "../hooks/useT";
import { useFmt } from "../hooks/useFmt";
import { Md } from "../components/message/Markdown";

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

function BilanBody({ id }: { id: string }) {
  const [detail, setDetail] = useState<BilanDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    getBilan(id)
      .then(setDetail)
      .catch((e) => setErr(String(e)));
  }, [id]);

  if (err) return <p style={{ color: "var(--red)", fontSize: 13 }}>{err}</p>;
  if (!detail) return <p style={{ color: "var(--muted)", fontSize: 13 }}>…</p>;

  return (
    <div style={{ fontSize: 13, lineHeight: 1.7 }}>
      <Md>{detail.body}</Md>
    </div>
  );
}

export default function Bilans() {
  const t = useT();
  const { fmtCost } = useFmt();
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
          <details key={b.id} className="msg">
            <summary className="head" style={{ cursor: "pointer", userSelect: "none" }}>
              <span
                className="chip"
                style={{ color: "var(--accent)", borderColor: "var(--accent)55", fontFamily: "var(--mono)", fontSize: 11 }}
              >
                {b.date}
              </span>
              <span style={{ fontWeight: 600, color: "var(--text)", fontSize: 13 }}>{b.title}</span>
              <span className="topbar-sep" />
              <PeriodLabel bilan={b} />
              {b.sessions !== null && (
                <>
                  <span className="topbar-sep" />
                  <span style={{ color: "var(--muted)", fontSize: 12 }}>
                    {b.sessions} {t("bilans_sessions")}
                  </span>
                </>
              )}
              {b.costUSD !== null && (
                <>
                  <span className="topbar-sep" />
                  <span style={{ color: "var(--green)", fontSize: 12 }}>
                    {fmtCost(b.costUSD)} {t("bilans_cost")}
                  </span>
                </>
              )}
            </summary>
            <div className="body" style={{ padding: "12px 16px" }}>
              <BilanBody id={b.id} />
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}
