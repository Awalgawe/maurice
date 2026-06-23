import fs from "node:fs";
import path from "node:path";
import {
  CONTEXT_WINDOW,
  decodeProjectId,
  projectLabel,
  sessionFilePath,
  subagentsDir,
  type SessionFile,
} from "../claudeDir.ts";
import { estimateCost, estimateCostByComponent } from "../pricing.ts";
import {
  contextTokens,
  emptyTokens,
  extractBlocks,
  isMcpTool,
  iterateJsonl,
  stringifyToolResult,
  tokensFromUsage,
} from "./jsonl.ts";
import type {
  ContentBlock,
  ContextPoint,
  MessageKind,
  SessionDetail,
  SessionError,
  SessionMeta,
  SubagentRef,
  ThreadMessage,
  TokenTotals,
} from "../../src/types.ts";

/** How many of a session's most recent failures to keep in the index. */
const MAX_SESSION_ERRORS = 8;

// A real model the agent ran, vs. a system-injected pseudo-model like
// "<synthetic>" (e.g. the "session limit reached" message). Pseudo-models must
// not appear in model lists or cost attribution.
function isRealModel(model: unknown): model is string {
  return typeof model === "string" && model.length > 0 && !model.startsWith("<");
}

// Jira-style ticket pattern. Defaults to a generic PREFIX-NUMBER form; override
// with TICKET_RE (e.g. "wmp-\\d+") to scope detection to one project's prefix.
const TICKET_RE = process.env.TICKET_RE
  ? new RegExp(process.env.TICKET_RE, "i")
  : /[A-Z]{2,}-\d+/i;

function findTicket(...candidates: string[]): string | null {
  for (const c of candidates) {
    const m = c && c.match(TICKET_RE);
    if (m) return m[0].toUpperCase();
  }
  return null;
}

function truncate(s: string, n = 160): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > n ? flat.slice(0, n) + "…" : flat;
}

// Local-time YYYY-MM-DD. The app is local (server TZ == user TZ), so day/hour
// attribution must use local time to match the rest of the UI (Sessions list,
// heatmap, Timeline), not UTC.
const pad = (n: number) => String(n).padStart(2, "0");
function localYmd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function countSubagents(projectId: string, id: string): number {
  try {
    return fs
      .readdirSync(subagentsDir(projectId, id))
      .filter((f) => f.endsWith(".jsonl")).length;
  } catch {
    return 0;
  }
}

/** Full streaming pass over one session file to build its index row + clean search text. */
export async function buildMetaAndText(file: SessionFile): Promise<{ meta: SessionMeta; searchText: string }> {
  const branches = new Set<string>();
  const skills = new Set<string>();
  const models = new Set<string>();
  const entrypoints = new Set<string>();
  const mcpTools = new Set<string>();
  const seenUsage = new Set<string>(); // dedup token usage by requestId/msgId

  let messageCount = 0;
  let start: string | null = null;
  let end: string | null = null;
  let errorCount = 0;
  const errors: SessionError[] = []; // bounded to the last MAX_SESSION_ERRORS
  const toolNameById = new Map<string, string>(); // tool_use_id → tool name
  let peakContextTokens = 0;
  let projectPath = "";
  let firstUserPrompt: string | null = null;
  // Cost is summed per-turn so each turn uses its own model's price.
  let estCostUSD = 0;
  // Cost split per local day ("YYYY-MM-DD") so a multi-day session isn't dated
  // entirely on its last message. Invariant: sum of values ≈ estCostUSD.
  const costByDay: Record<string, number> = {};
  // Local days with ≥1 message, and a (dow×hour) message-volume histogram —
  // power the Dashboard sessions/day and "when I work" charts at message level.
  const activeDays = new Set<string>();
  const activityHeat: Record<string, number> = {}; // key = dow*24+hour (Mon-first, local)
  const tokens: TokenTotals = emptyTokens();
  const costByComponent: TokenTotals = emptyTokens(); // USD per token component
  const skillTokens: Record<string, number> = {};
  const skillCost: Record<string, number> = {};
  const modelTokens: Record<string, number> = {};
  const modelCost: Record<string, number> = {};
  const textParts: string[] = [];

  for await (const obj of iterateJsonl(file.filePath)) {
    const ts: string | undefined = obj.timestamp;
    if (ts) {
      if (!start || ts < start) start = ts;
      if (!end || ts > end) end = ts;
    }
    if (obj.gitBranch) branches.add(obj.gitBranch);
    if (obj.attributionSkill) skills.add(obj.attributionSkill);
    if (obj.entrypoint) entrypoints.add(obj.entrypoint);
    if (!projectPath && obj.cwd) projectPath = obj.cwd;

    const type = obj.type;
    const msg = obj.message;

    if (type === "user" || type === "assistant") {
      messageCount++;
      if (ts) {
        const d = new Date(ts);
        activeDays.add(localYmd(d));
        const slot = ((d.getDay() + 6) % 7) * 24 + d.getHours(); // Monday-first
        activityHeat[slot] = (activityHeat[slot] || 0) + 1;
      }
    }

    if (type === "assistant" && msg) {
      if (isRealModel(msg.model)) models.add(msg.model);
      const key = obj.requestId || msg.id || obj.uuid;
      if (key && !seenUsage.has(key)) {
        seenUsage.add(key);
        const t = tokensFromUsage(msg.usage);
        tokens.input += t.input;
        tokens.output += t.output;
        tokens.cacheRead += t.cacheRead;
        tokens.cacheCreate += t.cacheCreate;
        const turnCostByComponent = estimateCostByComponent(msg.model, t);
        costByComponent.input += turnCostByComponent.input;
        costByComponent.output += turnCostByComponent.output;
        costByComponent.cacheRead += turnCostByComponent.cacheRead;
        costByComponent.cacheCreate += turnCostByComponent.cacheCreate;
        const turnCost =
          turnCostByComponent.input +
          turnCostByComponent.output +
          turnCostByComponent.cacheRead +
          turnCostByComponent.cacheCreate;
        estCostUSD += turnCost;
        // Attribute this turn's cost to its own local day (per-message bucketing).
        if (ts) {
          const day = localYmd(new Date(ts));
          costByDay[day] = (costByDay[day] || 0) + turnCost;
        }
        // Attribute this turn's tokens/cost to the skill active on this line.
        const sk = obj.attributionSkill || "(aucun)";
        skillTokens[sk] = (skillTokens[sk] || 0) + (t.input + t.output + t.cacheRead + t.cacheCreate);
        skillCost[sk] = (skillCost[sk] || 0) + turnCost;
        // Attribute to the model that produced this turn (pseudo-models → unknown).
        const mk = isRealModel(msg.model) ? msg.model : "(inconnu)";
        const turnTokens = t.input + t.output + t.cacheRead + t.cacheCreate;
        modelTokens[mk] = (modelTokens[mk] || 0) + turnTokens;
        modelCost[mk] = (modelCost[mk] || 0) + turnCost;
        const ctx = contextTokens(msg.usage);
        if (ctx > peakContextTokens) peakContextTokens = ctx;
      }
    }

    // Scan content blocks for tool_use (mcp) and tool_result (errors).
    const content = msg?.content;
    if (Array.isArray(content)) {
      for (const c of content) {
        if (!c || typeof c !== "object") continue;
        if (c.type === "tool_use") {
          if (isMcpTool(c.name || "")) mcpTools.add(c.name);
          if (c.id && c.name) toolNameById.set(c.id, c.name);
        }
        if (c.type === "tool_result" && c.is_error === true && !isUserInterruption(c)) {
          errorCount++;
          errors.push({
            ts: ts ?? null,
            tool: toolNameById.get(c.tool_use_id) || "tool",
            excerpt: truncate(stringifyToolResult(c.content), 140),
          });
          if (errors.length > MAX_SESSION_ERRORS) errors.shift(); // keep the most recent
        }
      }
    }

    if (firstUserPrompt === null && type === "user" && msg) {
      const text =
        typeof msg.content === "string"
          ? msg.content
          : Array.isArray(msg.content)
            ? msg.content.find((c: any) => c?.type === "text")?.text
            : "";
      // Skip tool_result-only user turns, system markers and command noise.
      const t = (text || "").trim();
      if (t && !t.startsWith("<") && !t.startsWith("[")) {
        firstUserPrompt = truncate(t);
      }
    }

    // Accumulate clean search text: user prompts + assistant text blocks only.
    // Excludes thinking, tool_use, tool_result, base64.
    if (msg && (type === "user" || type === "assistant")) {
      const c = msg.content;
      if (type === "user" && typeof c === "string") {
        if (c.trim()) textParts.push(c);
      } else if (Array.isArray(c)) {
        for (const block of c) {
          if (block?.type === "text" && block.text) textParts.push(block.text);
        }
      }
    }
  }

  if (!projectPath) projectPath = decodeProjectId(file.projectId);
  const branchList = [...branches];
  const ticket = findTicket(file.projectId, ...branchList);

  return {
    meta: {
      id: file.id,
      projectId: file.projectId,
      projectPath,
      projectLabel: projectLabel(projectPath),
      ticket,
      branches: branchList,
      skills: [...skills],
      models: [...models],
      entrypoints: [...entrypoints],
      messageCount,
      start,
      end,
      tokens,
      estCostUSD,
      costByDay,
      activeDays: [...activeDays].sort(),
      activityHeat,
      costByComponent,
      peakContextTokens,
      peakContextPct: Math.min(100, (peakContextTokens / CONTEXT_WINDOW) * 100),
      errorCount,
      hasErrors: errorCount > 0,
      errors,
      mcpTools: [...mcpTools],
      subagentCount: countSubagents(file.projectId, file.id),
      firstUserPrompt,
      skillTokens,
      skillCost,
      modelTokens,
      modelCost,
    },
    searchText: textParts.join("\n"),
  };
}

/** Build session metadata only (thin wrapper around buildMetaAndText). */
export async function buildMeta(file: SessionFile): Promise<SessionMeta> {
  return (await buildMetaAndText(file)).meta;
}

/** List subagent transcripts of a session (from the subagents/ dir + meta). */
export function listSubagents(projectId: string, id: string): SubagentRef[] {
  const dir = subagentsDir(projectId, id);
  let files: string[];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const refs: SubagentRef[] = [];
  for (const f of files) {
    if (!f.endsWith(".jsonl")) continue;
    const ref = f.replace(/\.jsonl$/, "");
    let agentType: string | null = null;
    let description: string | null = null;
    let toolUseId: string | null = null;
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, `${ref}.meta.json`), "utf8"));
      agentType = meta.agentType ?? null;
      description = meta.description ?? null;
      toolUseId = meta.toolUseId ?? null;
    } catch {
      /* meta optional */
    }
    let messageCount = 0;
    const models = new Set<string>();
    try {
      const raw = fs.readFileSync(path.join(dir, f), "utf8");
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        messageCount++;
        try {
          const model = JSON.parse(line)?.message?.model;
          if (isRealModel(model)) models.add(model);
        } catch {
          /* skip malformed line */
        }
      }
    } catch {
      /* ignore */
    }
    refs.push({ ref, agentType, description, toolUseId, messageCount, models: [...models] });
  }
  return refs;
}

const SUBAGENT_TOOLS = new Set(["Task", "Agent"]);

/**
 * Classify a turn beyond its raw role. A `user`-role turn carries tool output
 * (the protocol delivers tool_result inside a user turn), so a tool_result-only
 * user turn is tool/subagent output, not a human prompt; `isMeta` marks harness-
 * injected context. `toolNames` maps a tool_use id to its tool name so a
 * subagent (Task/Agent) report can be told apart from an ordinary tool result.
 */
// Claude Code reports a user-rejected/interrupted tool call as a tool_result
// with is_error: true. Those aren't real failures, so they must not count as
// errors (red minimap strip, error chip, dashboard error KPI…).
const USER_INTERRUPTION = "The user doesn't want to proceed with this tool use";

export function isUserInterruption(c: any): boolean {
  const v = c?.content;
  const text =
    typeof v === "string"
      ? v
      : Array.isArray(v)
        ? v.map((x: any) => (typeof x === "string" ? x : x?.text ?? "")).join(" ")
        : "";
  return text.includes(USER_INTERRUPTION);
}

/** A turn is in error only if it carries a genuine tool failure — user
 *  interruptions report is_error too but are excluded. */
export function hasRealError(content: any): boolean {
  return (
    Array.isArray(content) &&
    content.some((c: any) => c?.type === "tool_result" && c.is_error === true && !isUserInterruption(c))
  );
}

export function classifyMessage(
  obj: any,
  blocks: ContentBlock[],
  toolNames: Map<string, string>,
): MessageKind {
  if (obj.isMeta === true) return "meta";
  if (obj.type === "assistant") return "assistant";
  const toolResults = blocks.filter((b) => b.kind === "tool_result");
  const hasText = blocks.some((b) => b.kind === "text" || b.kind === "thinking");
  if (toolResults.length > 0 && !hasText) {
    const id = (toolResults[0] as { toolUseId: string | null }).toolUseId;
    const name = id ? toolNames.get(id) : undefined;
    return name && SUBAGENT_TOOLS.has(name) ? "subagent" : "tool_result";
  }
  return "human";
}

/** Record a turn's tool_use ids → names so later tool_result turns resolve. */
function recordToolUses(obj: any, toolNames: Map<string, string>): void {
  const content = obj?.message?.content;
  if (!Array.isArray(content)) return;
  for (const c of content) {
    if (c?.type === "tool_use" && c.id) toolNames.set(c.id, c.name || "?");
  }
}

/** Turn a raw line into a ThreadMessage (heavy: builds content blocks). */
function toThreadMessage(obj: any, toolNames: Map<string, string>): ThreadMessage {
  const msg = obj.message;
  const blocks = extractBlocks(msg);
  const isError = hasRealError(msg?.content);
  return {
    uuid: obj.uuid ?? null,
    type: obj.type,
    role: msg?.role ?? null,
    kind: classifyMessage(obj, blocks, toolNames),
    timestamp: obj.timestamp ?? null,
    model: msg?.model ?? null,
    skill: obj.attributionSkill ?? null,
    isSidechain: obj.isSidechain === true,
    isError,
    tokens: obj.type === "assistant" && msg?.usage ? tokensFromUsage(msg.usage) : null,
    blocks,
  };
}

const RENDERABLE = new Set(["user", "assistant"]);

const PERF = !!process.env.PERF;

/** A session fully parsed once and held in memory for fast pagination. */
interface ParsedSession {
  messages: ThreadMessage[]; // all renderable turns, in order
  context: ContextPoint[];
  subagents: SubagentRef[];
  size: number;
  mtimeMs: number;
}

// LRU of recently-viewed sessions. Bounded so memory stays reasonable; the
// heavy work (stream + JSON.parse + block extraction) happens once per file
// version, then pagination is a plain in-memory slice.
const parsedCache = new Map<string, ParsedSession>();
const PARSED_CACHE_MAX = 12;

/**
 * Parse a whole session into renderable messages + context curve, cached by
 * (size, mtime). Re-parses only when the file changed on disk.
 */
async function getParsedSession(meta: SessionMeta): Promise<ParsedSession> {
  const filePath = sessionFilePath(meta.projectId, meta.id);
  const key = `${meta.projectId}/${meta.id}`;

  let size = 0;
  let mtimeMs = 0;
  try {
    const stat = fs.statSync(filePath);
    size = stat.size;
    mtimeMs = stat.mtimeMs;
  } catch {
    /* file may have vanished; fall through and parse (will yield nothing) */
  }

  const cached = parsedCache.get(key);
  if (cached && cached.size === size && cached.mtimeMs === mtimeMs) {
    // bump as most-recently-used
    parsedCache.delete(key);
    parsedCache.set(key, cached);
    if (PERF) console.log(`[perf] getParsedSession ${meta.id} cache hit (${cached.messages.length} msgs)`);
    return cached;
  }

  const t0 = PERF ? Date.now() : 0;
  const context: ContextPoint[] = [];
  const seenUsage = new Set<string>();
  const messages: ThreadMessage[] = [];
  const toolNames = new Map<string, string>();
  let lines = 0;

  for await (const obj of iterateJsonl(filePath)) {
    lines++;
    if (obj.type === "assistant" && obj.message) {
      recordToolUses(obj, toolNames);
      const usageKey = obj.requestId || obj.message.id || obj.uuid;
      if (usageKey && !seenUsage.has(usageKey)) {
        seenUsage.add(usageKey);
        const ctx = contextTokens(obj.message.usage);
        if (ctx > 0) {
          context.push({
            t: obj.timestamp ?? "",
            contextTokens: ctx,
            pct: Math.min(100, (ctx / CONTEXT_WINDOW) * 100),
          });
        }
      }
    }
    if (!RENDERABLE.has(obj.type)) continue;
    messages.push(toThreadMessage(obj, toolNames));
  }

  const parsed: ParsedSession = {
    messages,
    context,
    subagents: listSubagents(meta.projectId, meta.id),
    size,
    mtimeMs,
  };
  parsedCache.set(key, parsed);
  while (parsedCache.size > PARSED_CACHE_MAX) {
    const oldest = parsedCache.keys().next().value as string;
    parsedCache.delete(oldest);
  }
  if (PERF) console.log(`[perf] getParsedSession ${meta.id} parsed ${lines} lines → ${messages.length} msgs in ${Date.now() - t0}ms`);
  return parsed;
}

/**
 * Read a session detail: paginated thread (renderable turns only), the full
 * context-fill curve, and subagent refs. The file is parsed once and cached;
 * pagination then slices the in-memory message array.
 */
export async function readDetail(
  meta: SessionMeta,
  offset: number,
  limit: number,
): Promise<SessionDetail> {
  const parsed = await getParsedSession(meta);
  return {
    meta,
    messages: parsed.messages.slice(offset, offset + limit),
    total: parsed.messages.length,
    offset,
    limit,
    context: parsed.context,
    subagents: parsed.subagents,
  };
}

/** Read a subagent transcript fully (they are small). */
export async function readSubagent(
  projectId: string,
  id: string,
  ref: string,
): Promise<ThreadMessage[]> {
  const file = path.join(subagentsDir(projectId, id), `${ref}.jsonl`);
  const out: ThreadMessage[] = [];
  const toolNames = new Map<string, string>();
  for await (const obj of iterateJsonl(file)) {
    if (obj.type === "assistant") recordToolUses(obj, toolNames);
    if (!RENDERABLE.has(obj.type)) continue;
    out.push(toThreadMessage(obj, toolNames));
  }
  return out;
}
