import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import type { CacheRewriteRef, MemoryEntry, SessionDetail as Detail } from "../types";
import { getDetail, getSessionMemories } from "../api";
import { skillLabel } from "../format";
import { useT } from "../hooks/useT";
import { ThreadDetail } from "../components/thread/ThreadDetail";
import { Chip } from "../components/ui/Chip";
import { ErrorState } from "../components/ui/ErrorState";
import { DETAIL_PAGE } from "../lib/messageLink";

const PAGE = DETAIL_PAGE;

export default function SessionDetail() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // 1-indexed page in URL (?page=2); defaults to 1 when absent, malformed, or
  // out of range (Number("abc") is NaN — Math.max(1, NaN) is NaN, not 1).
  const rawPage = Number(searchParams.get("page"));
  const pageNum = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
  const offset = (pageNum - 1) * PAGE;
  // Served view (?branch=f1): null = live thread, "fN" = an abandoned fork.
  const branch = searchParams.get("branch");

  const [data, setData] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [memoriesErr, setMemoriesErr] = useState<string | null>(null);
  const [memoriesNonce, setMemoriesNonce] = useState(0);
  const [reloadNonce, setReloadNonce] = useState(0);
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
    let live = true;
    setData(null);
    setErr(null); // clear a prior error so a later success isn't masked by it
    getDetail(id, offset, PAGE, branch)
      .then((d) => { if (live) setData(d); })
      .catch((e) => { if (live) setErr(String(e)); });
    return () => { live = false; }; // drop a stale response from a superseded page/branch
  }, [id, offset, branch, reloadNonce]);

  // Linked memories are a secondary source: a failure is shown in the panel (with
  // retry), never flattened to an empty list that reads as "no linked memories".
  useEffect(() => {
    if (!id) return;
    let live = true;
    setMemoriesErr(null);
    getSessionMemories(id)
      .then((m) => { if (live) { setMemories(m); setMemoriesErr(null); } })
      .catch((e) => { if (live) setMemoriesErr(String(e)); });
    return () => { live = false; };
  }, [id, memoriesNonce]);

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

  function goToPage(pg: number) {
    const params: Record<string, string> = {};
    if (pg !== 1) params.page = String(pg);
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

  if (err) return <ErrorState message={`${t("detail_error_prefix")}${err}`} onRetry={() => setReloadNonce((n) => n + 1)} />;
  if (!data) return <div className="center">{t("detail_loading")}</div>;

  const m = data.meta;
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
  // Session-level peer summary. Counted over the resolved views (both
  // directions, one key each), so it can never disagree with what the thread
  // renders. Absent = no cross-session traffic at all, and no chip.
  const peerViews = Object.values(data.peerEventViews ?? {});
  const peerCounts = peerViews.length
    ? {
        peers: data.peers.length,
        sent: peerViews.filter((v) => v.direction === "out").length,
        received: peerViews.filter((v) => v.direction === "in").length,
      }
    : null;

  return (
    <ThreadDetail
      sessionId={m.id}
      backTo={{ url: "/sessions", label: t("detail_back") }}
      title={m.aiTitle || m.projectPath}
      description={m.aiTitle ? m.projectPath : undefined}
      headerChips={
        <>
          {m.ticket && <Chip variant="ticket">{m.ticket}</Chip>}
          {m.branches.map((b) => <Chip key={b}>{b}</Chip>)}
          {m.skills.map((s) => <Chip variant="skill" key={s}>{skillLabel(s)}</Chip>)}
          {peerCounts && (
            <Chip
              title={`${t("peer_badge_title")} · ${peerCounts.peers} ${t("peer_badge_label")}`}
            >
              ⇄ {peerCounts.sent} {t("peer_badge_sent")} · {peerCounts.received} {t("peer_badge_received")}
            </Chip>
          )}
        </>
      }
      messages={data.messages}
      continuity={data.continuity}
      peerEventViews={data.peerEventViews}
      context={data.context}
      modelChanges={modelChanges}
      compactions={data.compactions}
      subagents={data.subagents}
      estCostUSD={m.estCostUSD}
      tokens={m.tokens}
      costByComponent={m.costByComponent}
      cacheRewriteWastedUSD={m.cacheRewriteWastedUSD}
      cacheRewriteWastedTokens={m.cacheRewriteWastedTokens}
      withSubagentsCostUSD={m.subagentsCostUSD ? m.estCostUSD + m.subagentsCostUSD : undefined}
      subagentsTokens={m.subagentsTokens}
      models={m.models}
      start={m.start}
      end={m.end}
      pager={{ page: pageNum, pages, total: data.total, onPage: goToPage }}
      branch={branch}
      forks={data.forks}
      onBranch={goToBranch}
      cacheRewrites={data.cacheRewrites}
      onRewrite={goToRewrite}
      mcpTools={m.mcpTools}
      memories={memories}
      memoriesError={memoriesErr}
      onReloadMemories={() => setMemoriesNonce((n) => n + 1)}
      resumeId={m.id}
      filesTouchedCount={m.filesTouchedCount}
      filesTouched={m.filesTouched}
    />
  );
}
