import { Fragment, Profiler, useEffect, useRef, useState } from "react";
import { useParams, Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CacheRewriteRef, MemoryEntry, SessionDetail as Detail, ThreadMessage } from "../types";
import { getDetail, getSessionMemories, getSubagent } from "../api";
import { modelLabel, skillLabel, totalTokens } from "../format";
import { useFmt } from "../hooks/useFmt";
import { useT } from "../hooks/useT";
import { Message } from "../components/message";
import { Minimap } from "../components/Minimap";
import { Pager } from "../components/ui/Pager";
import { Panel } from "../components/ui/Panel";
import { Chip } from "../components/ui/Chip";

const PAGE = 200;

const onRenderThread = import.meta.env.DEV
  ? (_id: string, phase: string, actualDuration: number) =>
      console.log(`[perf] thread render (${phase}) ${actualDuration.toFixed(0)}ms`)
  : undefined;

export default function SessionDetail() {
  const t = useT();
  const { fmtDate, fmtTokens, fmtCost } = useFmt();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // 1-indexed page in URL (?page=2); defaults to 1 when absent.
  const pageNum = Math.max(1, Number(searchParams.get("page") || "1"));
  const offset = (pageNum - 1) * PAGE;
  // Served view (?branch=f1): null = live thread, "fN" = an abandoned fork.
  const branch = searchParams.get("branch");

  const [data, setData] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [openSub, setOpenSub] = useState<string | null>(null);
  const [subMsgs, setSubMsgs] = useState<ThreadMessage[] | null>(null);
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [copied, setCopied] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const threadElRef = useRef<HTMLDivElement>(null);
  const prevId = useRef<string | undefined>(undefined);

  // When switching to a different session, reset to page 1 before fetching.
  useEffect(() => {
    if (!id || prevId.current === id) return;
    const switching = prevId.current !== undefined;
    prevId.current = id;
    if (switching && pageNum !== 1) setSearchParams({});
  }, [id, pageNum, setSearchParams]);

  useEffect(() => {
    if (!id) return;
    setData(null);
    getDetail(id, offset, PAGE, branch).then(setData).catch((e) => setErr(String(e)));
  }, [id, offset, branch]);

  // Search deep-link (#msg-<uuid>): scroll to the hit and flash it once loaded.
  useEffect(() => {
    if (!data) return;
    const hash = window.location.hash;
    if (!hash.startsWith("#msg-")) return;
    const el = document.getElementById(hash.slice(1));
    if (!el) return;
    el.scrollIntoView({ behavior: "instant", block: "center" });
    el.classList.add("flash");
    const timer = setTimeout(() => el.classList.remove("flash"), 2100);
    return () => clearTimeout(timer);
  }, [data]);

  function goToBranch(ref: string | null) {
    // Land on the divergence line of the branch we enter — or of the one we
    // leave when returning to the live thread — so the reader keeps their
    // bearings instead of being dropped at the top of the view.
    const info = data?.forks.find((f) => f.ref === (ref ?? branch));
    const idx = ref ? info?.forkPointIndex : info?.forkPointIndexLive;
    const params = new URLSearchParams();
    if (ref) params.set("branch", ref);
    let hash = "";
    if (info && idx !== undefined) {
      const page = Math.floor(idx / PAGE) + 1;
      if (page > 1) params.set("page", String(page));
      hash = `#msg-${info.forkPointUuid}`;
    }
    const qs = params.toString();
    navigate({ search: qs ? `?${qs}` : "", hash });
  }

  // Scroll thread into view (instant) on page change, skip on first load.
  const firstLoad = useRef(true);
  useEffect(() => {
    if (!data) return;
    if (firstLoad.current) { firstLoad.current = false; return; }
    threadRef.current?.scrollIntoView({ behavior: "instant", block: "start" });
  }, [data]);

  useEffect(() => {
    if (!id || !openSub) { setSubMsgs(null); return; }
    getSubagent(id, openSub).then((r) => setSubMsgs(r.messages)).catch(() => setSubMsgs([]));
  }, [id, openSub]);

  useEffect(() => {
    if (!id) return;
    getSessionMemories(id).then(setMemories).catch(() => setMemories([]));
  }, [id]);

  function goToPage(p: number) {
    const params: Record<string, string> = {};
    if (p !== 1) params.page = String(p);
    if (branch) params.branch = branch;
    setSearchParams(params);
  }

  // Jump to a flagged message: same-page → direct scroll + flash; other page →
  // navigate with the anchor and let the deep-link effect scroll after fetch.
  function goToRewrite(rw: CacheRewriteRef) {
    if (!rw.uuid) return;
    const el = document.getElementById(`msg-${rw.uuid}`);
    if (el) {
      el.scrollIntoView({ behavior: "instant", block: "center" });
      el.classList.add("flash");
      setTimeout(() => el.classList.remove("flash"), 2100);
      return;
    }
    const params = new URLSearchParams();
    const page = Math.floor(rw.index / PAGE) + 1;
    if (page > 1) params.set("page", String(page));
    if (branch) params.set("branch", branch);
    const qs = params.toString();
    navigate({ search: qs ? `?${qs}` : "", hash: `#msg-${rw.uuid}` });
  }

  if (err) return <div className="center">{t("detail_error_prefix")}{err}</div>;
  if (!data) return <div className="center">{t("detail_loading")}</div>;

  const m = data.meta;
  const peak = data.context.reduce((a, b) => Math.max(a, b.pct), 0);
  // Model switches on the main thread only — a subagent (sidechain) turn on a
  // different model is not a conversation-level model change.
  const modelChanges: { t: string; model: string }[] = [];
  {
    let prev: string | null = null;
    for (const p of data.context) {
      if (p.sidechain || !p.model) continue;
      if (prev !== null && p.model !== prev) modelChanges.push({ t: p.t, model: p.model });
      prev = p.model;
    }
  }
  const pages = Math.ceil(data.total / PAGE);

  return (
    <div className="detail">
      {/* Row 1: header spans both columns */}
      <div className="detail-header">
        <Link to="/sessions" className="muted">{t("detail_back")}</Link>
        <h2 style={{ margin: "6px 0" }}>{m.projectPath}</h2>
        <div className="muted">
          {m.ticket && <Chip variant="ticket">{m.ticket}</Chip>}
          {m.branches.map((b) => (
            <Chip key={b}>{b}</Chip>
          ))}
          {m.skills.map((s) => (
            <Chip variant="skill" key={s}>{skillLabel(s)}</Chip>
          ))}
        </div>
      </div>

      {/* Row 2: pager, left column only — collapses to 0 when hidden */}
      <div ref={threadRef} className="detail-pager" style={{ scrollMarginTop: 56 }}>
        <Pager page={pageNum} pages={pages} total={data.total} onPage={goToPage} />
      </div>

      {/* Row 3 left: messages + bottom pager */}
      <Profiler id="thread" onRender={onRenderThread ?? (() => {})}>
        <div ref={threadElRef} className="detail-thread">
          {branch && (
            <div className="fork-banner">
              <span>⑂ {t("detail_fork_banner")} — {branch}</span>
              <button onClick={() => goToBranch(null)}>{t("detail_fork_back")}</button>
            </div>
          )}
          {data.messages.map((msg, i) => (
            <Fragment key={msg.uuid || i}>
              <Message m={msg} />
              {msg.forksHere.length > 0 && (
                // Permanent branch switcher at the divergence point: the live
                // thread plus every branch forking here; the current view is
                // disabled so the line always shows where you are.
                <div className="fork-diverge">
                  <span>{t("detail_fork_diverges")}</span>
                  <button disabled={branch === null} onClick={() => goToBranch(null)}>
                    {t("detail_fork_live")}
                  </button>
                  {msg.forksHere.map((ref) => (
                    <button key={ref} disabled={ref === branch} onClick={() => goToBranch(ref)}>
                      ⑂ {ref}
                    </button>
                  ))}
                </div>
              )}
            </Fragment>
          ))}
          <Pager page={pageNum} pages={pages} total={data.total} onPage={goToPage} />
        </div>
      </Profiler>

      {/* Row 3 middle: minimap, between the thread and the metadata aside */}
      <Minimap messages={data.messages} threadRef={threadElRef} />

      {/* Row 3 right: aside — starts at same grid row as messages */}
      <aside className="detail-aside">
          <Panel title={t("detail_panel_cost")}>
            <div className="kv">
              <span className="k">{t("detail_cost_label")}</span>
              <span className="v cost">{fmtCost(m.estCostUSD)}</span>
            </div>
            <div className="kv">
              <span className="k">{t("detail_token_input")}</span>
              <span className="v">{fmtTokens(m.tokens.input)}</span>
            </div>
            <div className="kv">
              <span className="k">{t("detail_token_output")}</span>
              <span className="v">{fmtTokens(m.tokens.output)}</span>
            </div>
            <div className="kv">
              <span className="k">{t("detail_token_cache_read")}</span>
              <span className="v">{fmtTokens(m.tokens.cacheRead)}</span>
            </div>
            <div className="kv">
              <span className="k">{t("detail_token_cache_write")}</span>
              <span className="v">{fmtTokens(m.tokens.cacheCreate)}</span>
            </div>
            <div className="kv">
              <span className="k">{t("detail_token_total")}</span>
              <span className="v">{fmtTokens(totalTokens(m.tokens))}</span>
            </div>
            <div className="kv">
              <span className="k">{t("detail_models")}</span>
              <span className="v">{m.models.join(", ") || "—"}</span>
            </div>
            <div className="kv">
              <span className="k">{t("detail_period")}</span>
              <span className="v">
                {fmtDate(m.start)} → {fmtDate(m.end)}
              </span>
            </div>
          </Panel>

          <Panel title={`${t("detail_ctx_panel_prefix")}${peak.toFixed(0)}%)`}>
            {data.context.length > 1 ? (
              <ResponsiveContainer width="100%" height={140}>
                <AreaChart data={data.context} margin={{ top: 5, right: 5, bottom: 0, left: -20 }}>
                  <CartesianGrid stroke="#2a2f3a" vertical={false} />
                  <XAxis dataKey="t" tick={false} stroke="#2a2f3a" />
                  <YAxis domain={[0, 100]} tick={{ fill: "#8a91a0", fontSize: 11 }} stroke="#2a2f3a" />
                  <Tooltip
                    contentStyle={{ background: "#1e222b", border: "1px solid #2a2f3a", borderRadius: 6 }}
                    labelFormatter={(v) => fmtDate(String(v))}
                    formatter={(v: number, _name, item: { payload?: { model?: string | null } }) => [
                      `${v.toFixed(0)}%${item?.payload?.model ? ` — ${item.payload.model}` : ""}`,
                      t("detail_chart_tooltip"),
                    ]}
                  />
                  <ReferenceLine y={80} stroke="#fbbf24" strokeDasharray="4 4" />
                  {modelChanges.map((c) => (
                    <ReferenceLine
                      key={c.t}
                      x={c.t}
                      stroke="#c084fc"
                      strokeDasharray="4 4"
                      label={{
                        value: c.model.replace(/^claude-/, ""),
                        fill: "#c084fc",
                        fontSize: 10,
                        position: "insideTopRight",
                      }}
                    />
                  ))}
                  <Area
                    type="monotone"
                    dataKey="pct"
                    stroke="#6ea8fe"
                    fill="#6ea8fe33"
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="muted">{t("detail_ctx_empty")}</div>
            )}
            <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
              {t("detail_ctx_hint")}
            </div>
          </Panel>

          {data.cacheRewrites.length > 0 && (
            <Panel title={`⚠ ${t("detail_panel_rewrites")} (${data.cacheRewrites.length})`}>
              {data.cacheRewrites.map((rw) => (
                <div key={rw.uuid || rw.index} style={{ marginBottom: 8 }}>
                  <button
                    style={{ width: "100%", textAlign: "left" }}
                    onClick={() => goToRewrite(rw)}
                    title={t(rw.cause === "idle" ? "message_cache_rewrite_idle" : "message_cache_rewrite_edit")}
                  >
                    <strong>≈{fmtCost(rw.wastedUSD)}</strong>
                    <Chip variant="warn" style={{ marginLeft: 6 }}>
                      {t(rw.cause === "idle" ? "detail_rewrite_idle" : "detail_rewrite_edit")}
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
                  {fmtCost(data.cacheRewrites.reduce((a, rw) => a + rw.wastedUSD, 0))}
                </span>
              </div>
            </Panel>
          )}

          {m.mcpTools.length > 0 && (
            <Panel title={`${t("detail_panel_mcp")} (${m.mcpTools.length})`}>
              {m.mcpTools.map((tool) => (
                <Chip variant="sub" key={tool} style={{ display: "block", marginBottom: 4 }}>
                  {tool.replace(/^mcp__/, "")}
                </Chip>
              ))}
            </Panel>
          )}

          {data.subagents.length > 0 && (
            <Panel title={`${t("detail_panel_subagents")} (${data.subagents.length})`}>
              {data.subagents.map((s) => (
                <div key={s.ref} style={{ marginBottom: 8 }}>
                  <button
                    style={{ width: "100%", textAlign: "left" }}
                    onClick={() => setOpenSub(openSub === s.ref ? null : s.ref)}
                  >
                    <strong>{s.agentType || "agent"}</strong> · {s.messageCount} {t("detail_msgs")}
                    {s.models.length === 0 ? (
                      <Chip style={{ marginLeft: 6 }}>{t("detail_subagent_no_model")}</Chip>
                    ) : (
                      s.models.map((m) => (
                        <Chip variant="model" key={m} style={{ marginLeft: 6 }}>
                          {modelLabel(m)}
                        </Chip>
                      ))
                    )}
                    <div className="muted" style={{ fontSize: 12 }}>
                      {s.description || s.ref}
                    </div>
                  </button>
                  {openSub === s.ref && (
                    <div style={{ marginTop: 8 }}>
                      {!subMsgs && <div className="muted">{t("detail_subagent_loading")}</div>}
                      {subMsgs?.map((msg, i) => (
                        <Message key={msg.uuid || i} m={msg} compact />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </Panel>
          )}

          {data.forks.length > 0 && (
            <Panel title={`${t("detail_panel_forks")} (${data.forks.length})`}>
              <div style={{ marginBottom: 8 }}>
                <button
                  style={{ width: "100%", textAlign: "left", fontWeight: branch === null ? 700 : 400 }}
                  onClick={() => goToBranch(null)}
                  disabled={branch === null}
                >
                  {t("detail_fork_live")}
                </button>
              </div>
              {data.forks.map((f) => (
                <div key={f.ref} style={{ marginBottom: 8 }}>
                  <button
                    style={{ width: "100%", textAlign: "left", fontWeight: branch === f.ref ? 700 : 400 }}
                    onClick={() => goToBranch(f.ref)}
                    disabled={branch === f.ref}
                    title={t("detail_fork_view")}
                  >
                    <strong>⑂ {f.ref}</strong> · {f.messageCount} {t("detail_fork_msgs")}
                    {f.divergedAt && (
                      <Chip style={{ marginLeft: 6 }}>{fmtDate(f.divergedAt)}</Chip>
                    )}
                    {f.preview && (
                      <div className="muted" style={{ fontSize: 12 }}>{f.preview}</div>
                    )}
                  </button>
                </div>
              ))}
            </Panel>
          )}

          {memories.length > 0 && (
            <Panel title={`${t("detail_panel_memories")} (${memories.length})`}>
              {memories.map((mem) => (
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
          )}

          <Panel title={t("detail_panel_resume")}>
            <code style={{ fontSize: 12 }}>claude --resume {m.id}</code>
            <div style={{ marginTop: 8 }}>
              <button onClick={() => {
                navigator.clipboard?.writeText(`claude --resume ${m.id}`);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}>
                {copied ? t("detail_copy_done") : t("detail_copy_btn")}
              </button>
            </div>
          </Panel>
      </aside>
    </div>
  );
}
