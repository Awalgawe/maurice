import { Fragment, type ReactNode, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type {
  CacheRewriteRef,
  ContextPoint,
  ForkInfo,
  MemoryEntry,
  SubagentRef,
  ThreadMessage,
  TokenTotals,
} from "../../types";
import { useFmt } from "../../hooks/useFmt";
import { useT } from "../../hooks/useT";
import { Message } from "../message";
import { Minimap } from "../Minimap";
import { ContextChart } from "../ContextChart";
import { CostBreakdownChart } from "../CostBreakdownChart";
import { SubagentsPanel } from "./SubagentsPanel";
import { Pager } from "../ui/Pager";
import { Panel } from "../ui/Panel";
import { Chip } from "../ui/Chip";

export interface ThreadDetailProps {
  sessionId: string; // for subagent deep links
  backTo: { url: string; label: string };
  title: string;
  headerChips?: ReactNode;
  description?: string | null;

  messages: ThreadMessage[];
  context: ContextPoint[];
  modelChanges?: { t: string; model: string }[];
  compactions?: { t: string; trigger?: string }[];
  subagents: SubagentRef[]; // flat list → recursive tree

  estCostUSD: number;
  tokens: TokenTotals;
  // USD per token component (own cost only) — feeds the cost-breakdown donut.
  costByComponent: TokenTotals;
  // Estimated avoidable surcost from cache rewrites, own cost only — subset of
  // costByComponent.cacheCreate.
  cacheRewriteWastedUSD: number;
  // Tokens re-written instead of read, own transcript only — subset of
  // tokens.cacheCreate. Feeds the same chart row as cacheRewriteWastedUSD.
  cacheRewriteWastedTokens: number;
  // Cost including descendants. Rendered as a second line when it exceeds the
  // own cost (i.e. the node has subagents).
  withSubagentsCostUSD?: number;
  // Flat token sum of every descendant subagent — feeds the chart's
  // "Sub-agents" row. Absent/all-zero → that row is hidden.
  subagentsTokens?: TokenTotals;
  models: string[];
  start: string | null;
  end: string | null;

  // Root/session-only affordances — every one optional; absent → panel hidden.
  pager?: { page: number; pages: number; total: number; onPage: (p: number) => void };
  branch?: string | null;
  forks?: ForkInfo[];
  onBranch?: (ref: string | null) => void;
  cacheRewrites?: CacheRewriteRef[];
  onRewrite?: (rw: CacheRewriteRef) => void;
  mcpTools?: string[];
  memories?: MemoryEntry[];
  memoriesError?: string | null;
  onReloadMemories?: () => void;
  resumeId?: string;
  // Distinct files edited (file-history-snapshot union), capped list — value
  // rendered is the count, the (possibly larger) true total.
  filesTouchedCount?: number;
  filesTouched?: string[];
}

/** Agnostic thread view: renders a conversation node (a session root or a
 *  subagent) — thread + cost + context + recursive subagents — plus the
 *  root-only panels (pager, forks, cache-rewrites, MCP, memories, resume) when
 *  the caller supplies them. */
export function ThreadDetail(p: ThreadDetailProps) {
  const t = useT();
  const { fmtDate, fmtTokens, fmtCost } = useFmt();
  const threadElRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  const peak = p.context.reduce((a, b) => Math.max(a, b.pct), 0);
  const hasWithSub = p.withSubagentsCostUSD !== undefined && p.withSubagentsCostUSD > p.estCostUSD;

  // Search / anchor deep-link (#msg-<uuid>): scroll to the hit and flash it.
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.startsWith("#msg-")) return;
    const el = document.getElementById(hash.slice(1));
    if (!el) return;
    el.scrollIntoView({ behavior: "instant", block: "center" });
    el.classList.add("flash");
    const timer = setTimeout(() => el.classList.remove("flash"), 2100);
    return () => clearTimeout(timer);
  }, [p.messages]);

  return (
    <div className="detail">
      <div className="detail-header">
        <Link to={p.backTo.url} className="muted">{p.backTo.label}</Link>
        <h2 style={{ margin: "6px 0" }}>{p.title}</h2>
        {(p.headerChips || p.description) && (
          <div className="muted">{p.headerChips}</div>
        )}
        {p.description && (
          <div className="muted" style={{ marginTop: 4 }}>{p.description}</div>
        )}
      </div>

      {p.pager && (
        <div className="detail-pager" style={{ scrollMarginTop: 56 }}>
          <Pager page={p.pager.page} pages={p.pager.pages} total={p.pager.total} onPage={p.pager.onPage} />
        </div>
      )}

      <div ref={threadElRef} className="detail-thread">
        {p.branch && p.onBranch && (
          <div className="fork-banner">
            <span>⑂ {t("detail_fork_banner")} — {p.branch}</span>
            <button onClick={() => p.onBranch!(null)}>{t("detail_fork_back")}</button>
          </div>
        )}
        {p.messages.map((msg, i) => (
          <Fragment key={msg.uuid || i}>
            <Message m={msg} />
            {p.onBranch && msg.forksHere.length > 0 && (
              <div className="fork-diverge">
                <span>{t("detail_fork_diverges")}</span>
                <button disabled={p.branch == null} onClick={() => p.onBranch!(null)}>
                  {t("detail_fork_live")}
                </button>
                {msg.forksHere.map((ref) => (
                  <button key={ref} disabled={ref === p.branch} onClick={() => p.onBranch!(ref)}>
                    ⑂ {ref}
                  </button>
                ))}
              </div>
            )}
          </Fragment>
        ))}
        {p.pager && (
          <Pager page={p.pager.page} pages={p.pager.pages} total={p.pager.total} onPage={p.pager.onPage} />
        )}
      </div>

      <Minimap messages={p.messages} threadRef={threadElRef} />

      <aside className="detail-aside">
        <Panel title={t("detail_panel_cost")}>
          <CostBreakdownChart
            costByComponent={p.costByComponent}
            tokensByComponent={p.tokens}
            cacheRewriteWastedUSD={p.cacheRewriteWastedUSD}
            cacheRewriteWastedTokens={p.cacheRewriteWastedTokens}
            subagentsCostUSD={hasWithSub ? p.withSubagentsCostUSD! - p.estCostUSD : 0}
            subagentsTokens={p.subagentsTokens}
            estCostUSD={p.estCostUSD}
            withSubagentsCostUSD={hasWithSub ? p.withSubagentsCostUSD : undefined}
          />
          <div className="kv" style={{ marginTop: "1em" }}>
            <span className="k">{t("detail_models")}</span>
            <span className="v">{p.models.join(", ") || "—"}</span>
          </div>
          <div className="kv">
            <span className="k">{t("detail_period")}</span>
            <span className="v">{fmtDate(p.start)} → {fmtDate(p.end)}</span>
          </div>
          {!!p.filesTouchedCount && (
            <div className="kv">
              <span className="k">{t("detail_files_touched")}</span>
              <span className="v" title={(p.filesTouched ?? []).slice(0, 20).join("\n")}>
                {p.filesTouchedCount}
              </span>
            </div>
          )}
        </Panel>

        <Panel title={`${t("detail_ctx_panel_prefix")}${peak.toFixed(0)}%)`}>
          <ContextChart context={p.context} modelChanges={p.modelChanges} compactions={p.compactions} />
        </Panel>

        {p.cacheRewrites && p.cacheRewrites.length > 0 && p.onRewrite && (
          <Panel title={`⚠ ${t("detail_panel_rewrites")} (${p.cacheRewrites.length})`}>
            {p.cacheRewrites.map((rw) => (
              <div key={rw.uuid || rw.index} style={{ marginBottom: 8 }}>
                <button
                  style={{ width: "100%", textAlign: "left" }}
                  onClick={() => p.onRewrite!(rw)}
                  title={t(
                    rw.cause === "idle"
                      ? "message_cache_rewrite_idle"
                      : rw.cause === "tools-changed"
                        ? "message_cache_rewrite_tools"
                        : "message_cache_rewrite_edit",
                  )}
                >
                  <strong>≈{fmtCost(rw.wastedUSD)}</strong>
                  <Chip variant="warn" style={{ marginLeft: 6 }}>
                    {t(
                      rw.cause === "idle"
                        ? "detail_rewrite_idle"
                        : rw.cause === "tools-changed"
                          ? "detail_rewrite_tools"
                          : "detail_rewrite_edit",
                    )}
                  </Chip>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {fmtDate(rw.timestamp)} · {fmtTokens(rw.rewrittenTokens)} tokens
                  </div>
                </button>
              </div>
            ))}
            <div className="kv">
              <span className="k">{t("detail_rewrites_total")}</span>
              <span className="v cost">
                {fmtCost(p.cacheRewrites.reduce((a, rw) => a + rw.wastedUSD, 0))}
              </span>
            </div>
          </Panel>
        )}

        {p.mcpTools && p.mcpTools.length > 0 && (
          <Panel title={`${t("detail_panel_mcp")} (${p.mcpTools.length})`}>
            {p.mcpTools.map((tool) => (
              <Chip variant="sub" key={tool} style={{ display: "block", marginBottom: 4 }}>
                {tool.replace(/^mcp__/, "")}
              </Chip>
            ))}
          </Panel>
        )}

        <SubagentsPanel all={p.subagents} sessionId={p.sessionId} />

        {p.forks && p.forks.length > 0 && p.onBranch && (
          <Panel title={`${t("detail_panel_forks")} (${p.forks.length})`}>
            <div style={{ marginBottom: 8 }}>
              <button
                style={{ width: "100%", textAlign: "left", fontWeight: p.branch == null ? 700 : 400 }}
                onClick={() => p.onBranch!(null)}
                disabled={p.branch == null}
              >
                {t("detail_fork_live")}
              </button>
            </div>
            {p.forks.map((f) => (
              <div key={f.ref} style={{ marginBottom: 8 }}>
                <button
                  style={{ width: "100%", textAlign: "left", fontWeight: p.branch === f.ref ? 700 : 400 }}
                  onClick={() => p.onBranch!(f.ref)}
                  disabled={f.ref === p.branch}
                  title={t("detail_fork_view")}
                >
                  <strong>⑂ {f.ref}</strong> · {f.messageCount} {t("detail_fork_msgs")}
                  {f.divergedAt && <Chip style={{ marginLeft: 6 }}>{fmtDate(f.divergedAt)}</Chip>}
                  {f.preview && <div className="muted" style={{ fontSize: 12 }}>{f.preview}</div>}
                </button>
              </div>
            ))}
          </Panel>
        )}

        {p.memoriesError ? (
          <Panel title={t("detail_panel_memories")}>
            <div className="async-error-inline">
              <span style={{ color: "var(--red)", fontSize: 13 }}>{t("detail_memories_error")}</span>
              {p.onReloadMemories && (
                <button type="button" className="retry-btn" onClick={p.onReloadMemories}>
                  {t("async_retry")}
                </button>
              )}
            </div>
          </Panel>
        ) : p.memories && p.memories.length > 0 ? (
          <Panel title={`${t("detail_panel_memories")} (${p.memories.length})`}>
            {p.memories.map((mem) => (
              <div key={mem.name} style={{ marginBottom: 8 }}>
                <Chip variant="skill">{mem.type}</Chip>
                <span style={{ fontSize: 13, marginLeft: 6 }}>{mem.description || mem.name}</span>
              </div>
            ))}
            <div style={{ marginTop: 4 }}>
              <Link to="/memories" className="muted" style={{ fontSize: 12 }}>
                {t("detail_memories_link")}
              </Link>
            </div>
          </Panel>
        ) : null}

        {p.resumeId && (
          <Panel title={t("detail_panel_resume")}>
            <code style={{ fontSize: 12 }}>claude --resume {p.resumeId}</code>
            <div style={{ marginTop: 8 }}>
              <button
                onClick={() => {
                  navigator.clipboard?.writeText(`claude --resume ${p.resumeId}`);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                {copied ? t("detail_copy_done") : t("detail_copy_btn")}
              </button>
            </div>
          </Panel>
        )}
      </aside>
    </div>
  );
}
