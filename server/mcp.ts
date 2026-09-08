import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getIndex } from "./cache.ts";
import { readSessionDetail } from "./sessionDetail.ts";
import { computePeerGraph } from "./peers.ts";
import { listMemories } from "./parsers/memory.ts";
import { buildAgentRows } from "./parsers/agents.ts";
import { peerRegistry } from "./peerRegistry.ts";
import { listBilans, readBilan } from "./parsers/bilans.ts";
import { searchDocs } from "./parsers/searchIndex.ts";
import { computeFacets } from "./facets.ts";
import type { SearchHit, SessionMeta, TokenTotals } from "../src/types.ts";

/** Wrap any JSON-serialisable value as an MCP text content result. */
function json(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

/** A compact session row for list/search results — the full thread lives behind get_session. */
function summarize(s: SessionMeta) {
  return {
    id: s.id,
    projectId: s.projectId,
    projectLabel: s.projectLabel,
    projectPath: s.projectPath,
    ticket: s.ticket,
    branches: s.branches,
    skills: s.skills,
    models: s.models,
    start: s.start,
    end: s.end,
    messageCount: s.messageCount,
    tokens: s.tokens,
    estCostUSD: s.estCostUSD,
    peakContextPct: s.peakContextPct,
    hasErrors: s.hasErrors,
    subagentCount: s.subagentCount,
    firstUserPrompt: s.firstUserPrompt,
    aiTitle: s.aiTitle ?? null,
  };
}

function addTokens(into: TokenTotals, from: TokenTotals): void {
  into.input += from.input;
  into.output += from.output;
  into.cacheRead += from.cacheRead;
  into.cacheCreate += from.cacheCreate;
}

/**
 * Build a Maurice MCP server exposing the same read-only data as the web UI:
 * sessions (search/list/detail), memories, bilans, and cost/facet analytics.
 * All tools read through the existing parsers — no parsing logic is duplicated.
 */
export function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: "maurice", version: "0.1.0" },
    {
      instructions:
        "Maurice exposes your local Claude Code history (read-only): search and read past " +
        "sessions, list memories and bilans, and inspect estimated cost. Cost is an estimate " +
        "derived from a pricing table, not exact billing.",
    },
  );

  server.registerTool(
    "search_sessions",
    {
      title: "Search sessions",
      description:
        "Full-text search across all Claude Code conversation logs. Returns matching messages " +
        "with a short excerpt; `fork` is set when the match sits on a rewind-abandoned branch " +
        "(pass it as `branch` to get_session). Use get_session to read a full thread.",
      inputSchema: {
        q: z.string().min(3).describe("Search query (min 3 characters)"),
        limit: z.number().int().min(1).max(200).optional().describe("Max hits (default 50)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ q, limit }) => {
      const index = await getIndex(); // also ensures the FTS index is populated
      const metaById = new Map<string, SessionMeta>(index.map((s) => [s.id, s]));
      const hits: SearchHit[] = searchDocs(q.trim(), limit ?? 50)
        .map((r) => {
          const meta = metaById.get(r.sessionId);
          if (!meta) return null;
          return {
            sessionId: r.sessionId,
            projectId: r.projectId,
            projectLabel: meta.projectLabel,
            excerpt: r.excerpt,
            uuid: r.uuid || null,
            fork: r.fork,
            index: r.idx,
          } satisfies SearchHit;
        })
        .filter((h): h is SearchHit => h !== null);
      return json(hits);
    },
  );

  server.registerTool(
    "list_sessions",
    {
      title: "List sessions",
      description:
        "List sessions from the index, newest first, with optional filters. Returns compact rows; " +
        "use get_session for the full thread.",
      inputSchema: {
        project: z.string().optional().describe("Substring match on project id, label or path"),
        ticket: z.string().optional().describe("Ticket key, e.g. WMP-39588 (case-insensitive)"),
        skill: z.string().optional().describe("Only sessions that used this skill"),
        branch: z.string().optional().describe("Only sessions on this git branch"),
        model: z.string().optional().describe("Only sessions that used this model"),
        query: z.string().optional().describe("Substring match on the first user prompt"),
        hasErrors: z.boolean().optional().describe("Only sessions that recorded errors"),
        limit: z.number().int().min(1).max(200).optional().describe("Max rows (default 50)"),
        offset: z.number().int().min(0).optional().describe("Rows to skip (default 0)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ project, ticket, skill, branch, model, query, hasErrors, limit, offset }) => {
      let rows = [...(await getIndex())];
      const ci = (s: string) => s.toLowerCase();
      if (project) {
        const p = ci(project);
        rows = rows.filter(
          (s) => ci(s.projectId).includes(p) || ci(s.projectLabel).includes(p) || ci(s.projectPath).includes(p),
        );
      }
      if (ticket) rows = rows.filter((s) => s.ticket?.toLowerCase() === ci(ticket));
      if (skill) rows = rows.filter((s) => s.skills.includes(skill));
      if (branch) rows = rows.filter((s) => s.branches.includes(branch));
      if (model) rows = rows.filter((s) => s.models.includes(model));
      if (query) rows = rows.filter((s) => s.firstUserPrompt && ci(s.firstUserPrompt).includes(ci(query)));
      if (hasErrors !== undefined) rows = rows.filter((s) => s.hasErrors === hasErrors);

      rows.sort((a, b) => (b.start ?? "").localeCompare(a.start ?? ""));
      const total = rows.length;
      const start = offset ?? 0;
      const page = rows.slice(start, start + (limit ?? 50));
      return json({ total, offset: start, count: page.length, sessions: page.map(summarize) });
    },
  );

  server.registerTool(
    "get_session",
    {
      title: "Get session detail",
      description:
        "Read a session thread: metadata, a page of messages, the context-window curve, and subagent refs. " +
        "Messages are paginated — raise offset to read further. The default view is the live thread; " +
        "rewind-abandoned branches are listed in `forks` and readable via the `branch` parameter.",
      inputSchema: {
        id: z.string().describe("Session id (the .jsonl basename)"),
        offset: z.number().int().min(0).optional().describe("Message offset (default 0)"),
        limit: z.number().int().min(1).max(200).optional().describe("Max messages (default 50)"),
        branch: z.string().optional().describe('Fork ref (e.g. "f1") to read an abandoned branch instead of the live thread'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ id, offset, limit, branch }) => {
      const index = await getIndex();
      const meta = index.find((s) => s.id === id);
      if (!meta) return { isError: true, content: [{ type: "text" as const, text: `session not found: ${id}` }] };
      const detail = await readSessionDetail(
        index,
        peerRegistry(index),
        meta,
        Math.max(0, offset ?? 0),
        Math.min(200, Math.max(1, limit ?? 50)),
        branch ?? null,
      );
      if (!detail) return { isError: true, content: [{ type: "text" as const, text: `branch not found: ${branch}` }] };
      return json(detail);
    },
  );

  server.registerTool(
    "list_memories",
    {
      title: "List memories",
      description: "List parsed memory entries (the memory/*.md files), optionally filtered by project or origin session.",
      inputSchema: {
        projectId: z.string().optional().describe("Only memories under this encoded project id"),
        sessionId: z.string().optional().describe("Only memories whose originSessionId matches"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ projectId, sessionId }) => {
      let memories = listMemories();
      if (projectId) memories = memories.filter((m) => m.projectId === projectId);
      if (sessionId) memories = memories.filter((m) => m.originSessionId === sessionId);
      return json(memories);
    },
  );

  server.registerTool(
    "list_bilans",
    {
      title: "List bilans",
      description: "List periodic activity reports (bilans) with their metadata, newest first.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => json(listBilans()),
  );

  server.registerTool(
    "read_bilan",
    {
      title: "Read bilan",
      description:
        "Read a single bilan's full body by id — markdown, or a standalone HTML " +
        "document when the bilan's format is \"html\".",
      inputSchema: { id: z.string().describe("Bilan id, as returned by list_bilans") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ id }) => {
      const detail = readBilan(id);
      if (!detail) return { isError: true, content: [{ type: "text" as const, text: `bilan not found: ${id}` }] };
      return json(detail);
    },
  );

  server.registerTool(
    "cost_summary",
    {
      title: "Cost summary",
      description:
        "Aggregate estimated cost and token usage across all sessions, broken down by model, skill, and project. " +
        "Cost is an estimate from a pricing table, not exact billing.",
      inputSchema: {
        project: z.string().optional().describe("Limit to sessions matching this project id/label/path substring"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ project }) => {
      let rows = await getIndex();
      if (project) {
        const p = project.toLowerCase();
        rows = rows.filter(
          (s) =>
            s.projectId.toLowerCase().includes(p) ||
            s.projectLabel.toLowerCase().includes(p) ||
            s.projectPath.toLowerCase().includes(p),
        );
      }

      const totalTokens: TokenTotals = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 };
      let totalCost = 0;
      let earliest: string | null = null;
      let latest: string | null = null;
      const byModel = new Map<string, number>();
      const bySkill = new Map<string, number>();
      const byProject = new Map<string, { label: string; cost: number; sessions: number }>();

      for (const s of rows) {
        addTokens(totalTokens, s.tokens);
        totalCost += s.estCostUSD;
        if (s.start && (!earliest || s.start < earliest)) earliest = s.start;
        if (s.end && (!latest || s.end > latest)) latest = s.end;
        for (const [m, c] of Object.entries(s.modelCost)) byModel.set(m, (byModel.get(m) ?? 0) + c);
        for (const [sk, c] of Object.entries(s.skillCost)) bySkill.set(sk, (bySkill.get(sk) ?? 0) + c);
        const pj = byProject.get(s.projectId) ?? { label: s.projectLabel, cost: 0, sessions: 0 };
        pj.cost += s.estCostUSD;
        pj.sessions += 1;
        byProject.set(s.projectId, pj);
      }

      const ranked = (m: Map<string, number>) =>
        [...m.entries()].map(([key, costUSD]) => ({ key, costUSD })).sort((a, b) => b.costUSD - a.costUSD);

      return json({
        sessionCount: rows.length,
        periodStart: earliest,
        periodEnd: latest,
        totalTokens,
        estCostUSD: totalCost,
        byModel: ranked(byModel),
        bySkill: ranked(bySkill),
        byProject: [...byProject.entries()]
          .map(([projectId, v]) => ({ projectId, projectLabel: v.label, estCostUSD: v.cost, sessions: v.sessions }))
          .sort((a, b) => b.estCostUSD - a.estCostUSD),
      });
    },
  );

  server.registerTool(
    "recent_errors",
    {
      title: "Recent errors",
      description:
        "List the most recent recorded tool failures across sessions (is_error tool_results, excluding " +
        "user interruptions), newest first, with the failing tool, a message excerpt, and the session it " +
        "occurred in. Use get_session to read the full thread.",
      inputSchema: {
        project: z.string().optional().describe("Limit to sessions matching this project id/label/path substring"),
        limit: z.number().int().min(1).max(200).optional().describe("Max errors (default 20)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ project, limit }) => {
      let rows = await getIndex();
      if (project) {
        const p = project.toLowerCase();
        rows = rows.filter(
          (s) =>
            s.projectId.toLowerCase().includes(p) ||
            s.projectLabel.toLowerCase().includes(p) ||
            s.projectPath.toLowerCase().includes(p),
        );
      }
      const all = rows.flatMap((s) =>
        (s.errors ?? []).map((e) => ({
          ts: e.ts,
          tool: e.tool,
          excerpt: e.excerpt,
          sessionId: s.id,
          projectId: s.projectId,
          projectLabel: s.projectLabel,
          ticket: s.ticket,
        })),
      );
      all.sort((a, b) => (b.ts ?? "").localeCompare(a.ts ?? ""));
      const top = all.slice(0, limit ?? 20);
      return json({ total: all.length, count: top.length, errors: top });
    },
  );

  server.registerTool(
    "agents",
    {
      title: "Agents registry + usage",
      description:
        "List every agentType seen across subagent transcripts, joined with its on-disk definition when one exists " +
        "(~/.claude/agents, a project's .claude/agents, or an installed plugin). `origin` is inferred (no field marks " +
        "it): \"plugin\" for a namespaced name, \"custom\" when found in the user/project registry, \"builtin\" for a " +
        "hardcoded snapshot of Claude Code's shipped agents, else \"unknown\". Either `definitions` or `usage` can be " +
        "empty — a defined-but-never-used agent, or a used agentType with no matching definition.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => json({ agents: buildAgentRows(await getIndex()) }),
  );

  server.registerTool(
    "filters",
    {
      title: "Available filters",
      description:
        "List the facet values available across the index (projects, tickets, skills, branches, models, MCP tools) " +
        "with counts — useful before calling list_sessions with a filter.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => json(computeFacets(await getIndex())),
  );

  server.registerTool(
    "peers",
    {
      title: "Cross-session messages",
      description:
        "Cross-session (peer) messages: exchanges between two Claude Code sessions running side by side. `edges` are " +
        "resolved exchanges (one send matched to one receive, by msg_id or, for legacy envelopes, by body hash); " +
        "`unresolved` lists every event that could NOT be matched, with the reason — an ambiguous match never becomes " +
        "an edge. `excludedInProcess` counts SendMessage calls aimed at an in-process subagent, which are not peer " +
        "exchanges at all. Derived from the index and the live session registry on each call, never cached.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const index = await getIndex();
      return json(computePeerGraph(index, peerRegistry(index)));
    },
  );

  return server;
}
