import { useEffect, useState } from "react";
import type { McpInfo, McpToolDoc } from "../types";
import { getMcpTools } from "../api";
import { useT } from "../hooks/useT";

function CopyButton({ text }: { text: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="chip"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      style={{ cursor: "pointer", color: copied ? "var(--green)" : "var(--muted)", whiteSpace: "nowrap" }}
    >
      {copied ? t("mcp_copied") : t("mcp_copy")}
    </button>
  );
}

function CodeLine({ text }: { text: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <code
        style={{
          flex: 1,
          fontSize: 12.5,
          color: "var(--text)",
          background: "var(--panel-2)",
          border: "1px solid var(--border)",
          borderRadius: 4,
          padding: "6px 10px",
          overflowX: "auto",
          whiteSpace: "pre",
        }}
      >
        {text}
      </code>
      <CopyButton text={text} />
    </div>
  );
}

function ToolCard({ tool }: { tool: McpToolDoc }) {
  const t = useT();
  return (
    <div className="msg" style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <code style={{ fontSize: 14, fontWeight: 600, color: "var(--accent)" }}>{tool.name}</code>
        {tool.title && <span style={{ color: "var(--muted)", fontSize: 13 }}>{tool.title}</span>}
      </div>
      {tool.description && (
        <p style={{ margin: 0, fontSize: 13, color: "var(--text)", lineHeight: 1.5 }}>{tool.description}</p>
      )}
      {tool.params.length === 0 ? (
        <span style={{ color: "var(--muted)", fontSize: 12 }}>{t("mcp_no_params")}</span>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {tool.params.map((p) => (
            <div
              key={p.name}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(110px, auto) auto 1fr",
                gap: 10,
                alignItems: "baseline",
                fontSize: 12.5,
                padding: "3px 0",
                borderTop: "1px solid var(--border)",
              }}
            >
              <code style={{ color: "var(--text)" }}>
                {p.name}
                <span style={{ color: p.required ? "var(--amber)" : "var(--muted)", fontSize: 10, marginLeft: 6 }}>
                  {p.required ? t("mcp_param_required") : t("mcp_param_optional")}
                </span>
              </code>
              <span style={{ color: "var(--muted)", fontFamily: "monospace" }}>
                {p.type}
                {p.constraints ? ` · ${p.constraints}` : ""}
              </span>
              <span style={{ color: "var(--muted)" }}>{p.description ?? ""}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SectionTitle({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <div
      style={{
        margin: "22px 0 10px",
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
      <span>{children}</span>
      {count !== undefined && <span style={{ opacity: 0.6 }}>{count}</span>}
    </div>
  );
}

export default function Mcp() {
  const t = useT();
  const [info, setInfo] = useState<McpInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    getMcpTools()
      .then(setInfo)
      .catch((e) => setErr(String(e)));
  }, []);

  if (err) return <div><p style={{ color: "var(--red)" }}>{t("mcp_error")}</p></div>;
  if (!info) return <div />;

  const endpoint = `http://localhost:${info.port}/mcp`;
  const installCmd = `claude mcp add --transport http maurice ${endpoint}`;

  return (
    <div>
      <p style={{ margin: "4px 0 0", fontSize: 14, color: "var(--text)", lineHeight: 1.5, maxWidth: 760 }}>
        {t("mcp_intro")}
      </p>

      <SectionTitle>{t("mcp_install_title")}</SectionTitle>
      <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--muted)", lineHeight: 1.5, maxWidth: 760 }}>
        {t("mcp_install_hint")}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 760 }}>
        <CodeLine text={installCmd} />
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "var(--muted)", fontSize: 12, minWidth: 70 }}>{t("mcp_endpoint_label")}</span>
          <CodeLine text={endpoint} />
        </div>
      </div>
      <p style={{ margin: "12px 0 0", fontSize: 12, color: "var(--muted)", lineHeight: 1.5, maxWidth: 760 }}>
        {t("mcp_readonly_note")}
      </p>

      <SectionTitle count={info.tools.length}>{t("mcp_tools_title")}</SectionTitle>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {info.tools.map((tool) => (
          <ToolCard key={tool.name} tool={tool} />
        ))}
      </div>
    </div>
  );
}
