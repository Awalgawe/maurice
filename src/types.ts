// Shared types between the Express server and the React frontend.

export interface TokenTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate: number;
}

/** A detected prompt-cache rewrite on an assistant request: the previous
 *  context was not served back as cache reads (expired or invalidated) and was
 *  re-written at the cache-write rate instead — an avoidable surcost when the
 *  cause is an idle gap beyond the provider's cache TTL. */
export interface CacheRewrite {
  // idle = gap > cache TTL (expiry is certain); tools-changed = the request's
  // tool definitions changed (diagnostics.cache_miss_reason, authoritative);
  // context-edit = anything else (compact, rewind…).
  cause: "idle" | "context-edit" | "tools-changed";
  rewrittenTokens: number; // previous-context tokens re-written instead of read
  wastedUSD: number; // estimated surcost vs a warm cache (write − read rate)
  gapMs: number | null; // time since the previous billed request
}

/** One recorded tool failure in a session: an `is_error` tool_result that is
 *  not a user interruption. Bounded to the last few per session in the index. */
export interface SessionError {
  ts: string | null; // ISO timestamp of the failing turn
  tool: string; // tool name resolved from tool_use_id, or "tool" when unknown
  excerpt: string; // short single-line excerpt of the failure message
}

/** One row in the session explorer / one entry of the cached index. */
export interface SessionMeta {
  id: string; // sessionId (the .jsonl basename)
  projectId: string; // encoded project dir name
  projectPath: string; // human-readable cwd
  projectLabel: string; // short label (last path segment(s))
  ticket: string | null; // e.g. "WMP-39588"
  branches: string[];
  skills: string[]; // from attributionSkill
  models: string[];
  entrypoints: string[];
  messageCount: number;
  start: string | null; // ISO timestamp
  end: string | null;
  tokens: TokenTotals;
  estCostUSD: number;
  // Estimated USD cost split per local day (key "YYYY-MM-DD"), aggregated at the
  // message level. Sum ≈ estCostUSD. Lets the Dashboard cost-over-time chart
  // spread a multi-day session's cost across the days it actually spanned,
  // rather than dating all of it on its last message (s.end).
  costByDay: Record<string, number>;
  // Local days ("YYYY-MM-DD") with ≥1 message — a multi-day session counts on
  // each active day in the Dashboard sessions/day chart.
  activeDays: string[];
  // Message-volume histogram, key = dow*24+hour (Monday-first, local) → count.
  // Powers the "when I work" heatmap at message level (not just session start).
  activityHeat: Record<string, number>;
  // Estimated USD cost split per token component (input/output/cacheRead/cacheCreate).
  // Same shape as TokenTotals, but values are USD, not token counts.
  // Invariant: sum of the four ≈ estCostUSD (rounding aside).
  costByComponent: TokenTotals;
  peakContextTokens: number;
  peakContextPct: number; // max of per-turn ctx / that turn's model window
  errorCount: number;
  hasErrors: boolean;
  errors: SessionError[]; // last few recorded failures, newest last
  // Cache-rewrite anomalies (see CacheRewrite): how many billed requests
  // re-wrote their context instead of reading it, and the estimated total
  // avoidable surcost. Lets the Sessions list surface wasteful sessions.
  cacheRewriteCount: number;
  cacheRewriteWastedUSD: number;
  cacheRewriteWastedTokens: number;
  mcpTools: string[];
  subagentCount: number;
  // Aggregate cost/tokens of ALL subagent transcripts of this session (own cost
  // of every subagent, summed flat — the dir is flat). Optional: absent on
  // pre-v13 cache entries and on sessions with no subagents. NOT folded into
  // estCostUSD/tokens (those stay the session's own cost, to keep the per-skill
  // / per-model attribution intact). "Cost with subagents" = estCostUSD + this.
  subagentsCostUSD?: number;
  subagentsTokens?: TokenTotals;
  // Same aggregate, ventilated per agentType (own cost of every subagent of
  // that type, summed flat — same no-double-counting convention as above).
  // Optional for the same reason: absent on pre-v14 cache entries.
  subagentsByType?: Record<string, { count: number; costUSD: number; tokens: TokenTotals }>;
  firstUserPrompt: string | null; // short preview for the list
  // Claude-generated session title / agent name (standalone "ai-title" /
  // "agent-name" JSONL lines, last wins). Optional: absent pre-v17 cache.
  aiTitle?: string | null;
  agentName?: string | null;
  // Per-skill attribution (by attributionSkill on each assistant turn), so the
  // Workflow skill pivot doesn't double-count a session across its skills.
  skillTokens: Record<string, number>;
  skillCost: Record<string, number>;
  // Per-model attribution (mirrors skillCost but keyed on msg.model).
  modelTokens: Record<string, number>;
  modelCost: Record<string, number>;
}

/**
 * What a `user`/`assistant` turn really is. A `user`-role turn carries tool
 * output too (the protocol delivers tool_result in a user turn), so `role`
 * alone mislabels subagent reports and injected context as "User".
 */
export type MessageKind = "human" | "assistant" | "tool_result" | "subagent" | "meta";

/** A single rendered message in the detail thread. */
export interface ThreadMessage {
  uuid: string | null;
  type: string; // raw JSONL entry type: "user" | "assistant"
  role: string | null;
  kind: MessageKind;
  timestamp: string | null;
  model: string | null;
  skill: string | null;
  isSidechain: boolean;
  isError: boolean;
  tokens: TokenTotals | null;
  // Set on the first message of a billed request whose usage shows the prompt
  // cache was re-written instead of read (null = normal turn).
  cacheRewrite: CacheRewrite | null;
  blocks: ContentBlock[];
  // Rewind-abandoned branch owning this turn (null = live thread). Parallel
  // tool-call siblings are NOT forks — they share the turn's requestId.
  fork: string | null;
  // Refs of the abandoned branches that diverge right after this turn.
  forksHere: string[];
}

/** One cache-rewrite occurrence located within a served view, so the aside
 *  can deep-link to the flagged message (page + anchor). */
export interface CacheRewriteRef extends CacheRewrite {
  uuid: string | null;
  timestamp: string | null;
  index: number; // position within the served view → page + anchor deep-link
}

/** One rewind-abandoned branch of a session's parentUuid tree. */
export interface ForkInfo {
  ref: string; // stable per file version: "f1", "f2", … in file order
  forkPointUuid: string; // last turn shared with the live thread
  divergedAt: string | null; // timestamp where the branch splits off
  messageCount: number; // renderable turns owned by the branch (prefix excluded)
  preview: string | null; // first human prompt of the branch, truncated
  // Position of the fork point within each served view, so the UI can land on
  // the divergence line (page + anchor) when switching branches.
  forkPointIndex: number; // …within this branch's own view
  forkPointIndexLive: number; // …within the live thread view
}

/** A base64-encoded inline image (user attachment or tool_result payload). */
export interface InlineImage {
  mediaType: string;
  data: string;
}

export type ContentBlock =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool_use"; name: string; isMcp: boolean; input: unknown; id: string | null }
  | {
      kind: "tool_result";
      isError: boolean;
      text: string;
      toolUseId: string | null;
      images: InlineImage[];
    }
  | ({ kind: "image" } & InlineImage);

export interface ContextPoint {
  t: string; // timestamp
  contextTokens: number; // input + cache_read + cache_create at that turn
  pct: number; // over that turn's model window
  model: string | null; // null for pseudo-models ("<synthetic>")
  sidechain?: boolean; // subagent turn — excluded from model-change markers
}

export interface SubagentRef {
  ref: string; // file id (agent-xxx)
  agentType: string | null;
  description: string | null;
  toolUseId: string | null; // the tool_use that spawned this subagent (from .meta.json)
  messageCount: number;
  models: string[];
  // Own cost/tokens of this subagent's transcript (its turns only).
  tokens: TokenTotals;
  estCostUSD: number;
  // Own cost/tokens PLUS every descendant subagent's, recursively. A subagent
  // can itself spawn subagents (linked via toolUseId); childRefs are its direct
  // children. Equal to the own figures when childRefs is empty.
  costWithChildrenUSD: number;
  tokensWithChildren: TokenTotals;
  childRefs: string[];
  start: string | null;
  end: string | null;
  peakContextPct: number; // max per-turn ctx / that turn's model window
  errorCount: number;
}

/** Full view of one subagent transcript — the session-like detail. */
export interface SubagentDetail {
  sessionId: string; // owning session id
  ref: string;
  // The node this subagent was spawned from: another subagent (nested) or null
  // when it hangs directly off the session. Drives the "back" link.
  parentRef: string | null;
  parentAgentType: string | null;
  agentType: string | null;
  description: string | null;
  messages: ThreadMessage[]; // whole transcript (small, not paginated)
  context: ContextPoint[];
  tokens: TokenTotals;
  estCostUSD: number;
  // Estimated USD cost split per token component — same shape as
  // SessionMeta.costByComponent, sum ≈ estCostUSD.
  costByComponent: TokenTotals;
  // Estimated avoidable surcost from cache rewrites within this transcript
  // alone — subset of costByComponent.cacheCreate.
  cacheRewriteWastedUSD: number;
  cacheRewriteWastedTokens: number;
  costWithChildrenUSD: number;
  tokensWithChildren: TokenTotals;
  models: string[];
  start: string | null;
  end: string | null;
  peakContextPct: number;
  errorCount: number;
  // Every transitive descendant of this subagent, flat (each carries its own
  // childRefs). Same shape as SessionDetail.subagents, so one recursive panel
  // renders the tree for a session root and a subagent node alike.
  subagents: SubagentRef[];
}

export interface SessionDetail {
  meta: SessionMeta;
  messages: ThreadMessage[];
  total: number; // total messages of the served view (for pagination)
  offset: number;
  limit: number;
  context: ContextPoint[];
  subagents: SubagentRef[];
  forks: ForkInfo[];
  // Every cache rewrite of the served view, in thread order — powers the
  // aside's quick-navigation list (not limited to the current page).
  cacheRewrites: CacheRewriteRef[];
  branch: string | null; // served view: null = live thread, "f1"… = a fork
}

export interface Facets {
  projects: { value: string; label: string; count: number }[];
  tickets: { value: string; count: number }[];
  skills: { value: string; count: number }[];
  branches: { value: string; count: number }[];
  models: { value: string; count: number }[];
  mcpTools: { value: string; count: number }[];
}

export interface SearchHit {
  sessionId: string;
  projectId: string;
  projectLabel: string;
  excerpt: string;
  uuid: string | null; // matched message (null on legacy line-scan fallback)
  fork: string | null; // branch owning the match (null = live thread)
  index: number; // position of the message within its view → page deep-link
}

export interface ActiveSession {
  active: true;
  sessionCount: number;
  projectPath: string; // empty string when sessionCount > 1
  elapsedMs: number;
  tokens: TokenTotals;
  estCostUSD: number;
  messageCount: number;
  model: string | null;
}

export interface BilanMeta {
  id: string;
  filename: string;
  date: string;
  periodStart: string | null;
  periodEnd: string | null;
  sessions: number | null;
  costUSD: number | null;
  generatedAt: string | null;
  title: string;
}

export interface BilanDetail extends BilanMeta {
  body: string;
}

export interface MemoryEntry {
  name: string;
  filename: string;
  description: string;
  type: "feedback" | "user" | "reference" | "project" | string;
  projectId: string;
  projectLabel: string;
  body: string;
  originSessionId?: string;
}

/** A plan-mode markdown file, from ~/.claude/plans/ (global) or <repo>/.claude/plans/ (project). */
export interface PlanEntry {
  filename: string;
  title: string; // first "# heading", falls back to the filename without .md
  scope: "global" | "project";
  projectId: string; // GLOBAL_PLANS_ID for global plans, else the encoded project dir name
  projectLabel: string;
  mtimeMs: number;
  body: string; // full markdown (plan files have no frontmatter)
  ticket: string | null; // ticket key from the filename or title (e.g. "WMP-39530")
}

/** One hook command flattened out of a settings.json `hooks` block. Read-only. */
export interface HookEntry {
  event: string; // "Stop", "UserPromptSubmit", "PreToolUse", ...
  matcher: string; // "" means it fires for everything
  type: string; // "command"
  command: string;
  async: boolean;
  timeout: number | null;
  scope: "global" | "global-local" | "project" | "project-local";
  projectId: string | null; // null for global scopes, else the encoded project dir name
  projectLabel: string | null;
  sourceFile: string; // absolute path of the settings.json the hook came from
}

/** One input parameter of an MCP tool, flattened from its JSON-schema for display. */
export interface McpToolParam {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  constraints?: string; // e.g. "1–200", "min 3 chars"
}

/** One MCP tool, as exposed by the Maurice MCP server. */
export interface McpToolDoc {
  name: string;
  title?: string;
  description?: string;
  params: McpToolParam[];
}

/** Self-documentation payload for the MCP page: the server port + its tools. */
export interface McpInfo {
  port: number;
  tools: McpToolDoc[];
}

export type AgentSource = "user" | "project" | "plugin";
// No field in a subagent's .meta.json marks its origin — "builtin" is inferred
// from a hardcoded snapshot of Claude Code's shipped agentType values, so it
// drifts across Claude Code versions. See classifyAgentType.
export type AgentOrigin = "builtin" | "custom" | "plugin" | "unknown";

/** One agent definition found on disk (a parsed `.claude/agents/*.md`). */
export interface AgentDefinition {
  name: string; // plugin agents are namespaced "plugin:name", matching agentType
  description: string;
  model: string | null;
  color: string | null;
  tools: string[] | null; // null = no `tools:` key (agent can use every tool)
  source: AgentSource;
  filePath: string;
  projectId: string | null; // only set for source === "project"
  projectLabel: string | null;
}

/** Usage aggregate for one agentType across every session that ran it. */
export interface AgentUsage {
  runs: number; // subagent transcripts of this agentType
  sessions: number; // distinct sessions that ran ≥1
  costUSD: number;
  tokens: TokenTotals;
  lastUsed: string | null; // `end` of the most recent session that ran this agentType
}

/** One row of the /agents view: registry definition(s) and/or usage, joined by
 *  name — either side may be absent (an orphan: defined-never-used, or
 *  used-without-a-definition, e.g. a project whose .claude/agents no longer
 *  exists on disk). */
export interface AgentRow {
  name: string;
  origin: AgentOrigin;
  definitions: AgentDefinition[]; // every registry entry matching this name (possibly >1 across projects)
  usage: AgentUsage | null;
}
