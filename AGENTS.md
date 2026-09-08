# AGENTS.md

Guidance for AI coding agents working on Maurice. For the human-facing overview, see [README.md](README.md).

## Project overview

Maurice is a **local, read-only** web explorer for the `~/.claude` folder (Claude Code conversation logs): sessions, estimated cost, context-window usage, and a workflow view pivoted by skill / ticket / branch.

Architecture:

- `server/` — Express API (port `5174`), run with `tsx` (TypeScript executed directly, **imports use explicit `.ts` extensions**).
  - `server/parsers/` — streaming JSONL parsers for sessions, search index, bilans, memory.
  - `server/cache.ts` — session index disk-cached in `.cache/`, invalidated by `(size, mtime)`.
  - `server/pricing.ts` — per-model cost estimation table (subscriptions report `costUSD: 0`).
  - `server/routes/api.ts` — all API routes; unknown `/api` routes must 404 as JSON, never fall through to the SPA fallback.
  - `server/mcp.ts` + `server/routes/mcp.ts` — MCP server (streamable HTTP at `/mcp`) exposing the read-only data as tools. `createMcpServer()` reuses the same parsers/cache as the API — no parsing logic is duplicated. Stateless transport, loopback-only with DNS-rebinding protection; mounted before the SPA fallback.
  - `server/facets.ts` — `computeFacets(index)`, shared by the `/api/filters` route and the MCP `filters` tool.
  - `server/parsers/peers.ts` — cross-session (peer) messages, read from one transcript: envelope detection/decoding for received turns, and a `SendMessage` collector correlating each send to its `tool_result` by tool_use id. Purely local and syntactic — it never reads the live session registry.
  - `server/peers.ts` — `computePeerGraph(index, registry)`: joins the per-session events into cross-session edges (by `msg_id`, with a body-hash fallback for legacy envelopes). Pure, derived from the index on every request, never persisted. Any ambiguity becomes an `unresolved` entry rather than a guessed edge.
  - `server/sessionDetail.ts` — `readSessionDetail(...)`, the single assembly point for a session detail (local thread + peer resolution). `routes/api.ts` and the MCP `get_session` tool both go through it, so the two can never serve different shapes.
- `src/` — React 18 + Vite SPA (dev port `5173`, proxies `/api` to `5174`).
  - `src/pages/` — one file per route (Dashboard, Sessions, SessionDetail, Workflow, Timeline, Memories, Plans, Hooks, Mcp, Bilans).
  - `src/components/` — `layout/` (topbar, selectors), `message/` (thread rendering, per-tool renderers in `message/tools/`), `ui/` (generic primitives).
  - `src/state/` — React contexts (theme, language, editor).
  - `src/i18n/` — translations (`fr.ts` is the key source of truth, `en.ts` mirrors it).
- Prod: `vite build` emits `dist/`, served by the Express server itself (`npm start`).

## Commands

```bash
npm run dev      # Vite UI :5173 + Express API :5174 (concurrently)
npm run dev:api  # API only
npm test         # vitest run (node environment, no DOM)
npm run build    # vite build → dist/
npm start        # production: serves dist/ + API on :5174
```

Environment variables: `CLAUDE_DIR` (default `~/.claude`), `PORT` (default `5174`), `CONTEXT_WINDOW` (default `200000`), `PERF=1` (per-request API timing logs).

## Hard constraints

- **Never write to `~/.claude`** (or `CLAUDE_DIR`). The whole app is read-only on its source data. The only sanctioned write exceptions are the explicit user-driven file operations: the memory-deletion endpoint (`DELETE /api/memories`) and the plan management endpoints (`DELETE`/`PATCH /api/plans`, which delete or rename plan files in `~/.claude/plans/` and `<repo>/.claude/plans/`). All such endpoints are loopback-only and confine every path to its own directory by basename. Caches go in the project-local `.cache/`.
- **Cost is an estimate**, derived from `server/pricing.ts`. Don't present it as exact billing.
- Token/cost attribution in the skill pivot is **per message** (`attributionSkill`) to avoid double-counting across skills — preserve this invariant when touching aggregation code.
- The disk cache (`.cache/index.json`) holds **only** what one transcript derives on its own. Anything depending on the live session registry (`~/.claude/sessions/`) or on other sessions — the whole peer join — is recomputed per request, like `computeFacets`. Never persist raw tool-result text: an unrecognized result may echo its own input back.
- A **false cross-session link is worse than an unresolved exchange**: every ambiguity in `computePeerGraph` must end as `unresolved`, never as a guessed edge.

## Code style

- TypeScript everywhere, ESM (`"type": "module"`).
- **i18n**: no hardcoded user-facing strings in components. Add a key to **both** `src/i18n/fr.ts` and `src/i18n/en.ts`, use it via the `useT` hook. `I18nKey` is derived from `fr.ts`.
- **Theming**: all colors, radii, spacing, and shadows come from CSS custom properties in `src/index.css` (`:root` + `[data-theme="..."]` blocks). Never hardcode color values in components; add a token if one is missing, and define it for every theme.
- Comments are sparse and state non-obvious constraints, not what the code does. Match the existing density.
- Keep logical UI groupings intact: don't split semantically related elements in the DOM to achieve visual alignment — use CSS (grid rows, subgrid, padding) instead.

## Testing

- Vitest, `environment: "node"`, no DOM — tests cover server-side logic.
- Tests are colocated: `foo.test.ts` next to `foo.ts` (see `server/parsers/`, `server/pricing.test.ts`).
- Run `npm test` before considering a server-side change done. Parser changes need a test against representative JSONL fixtures.

## Documentation screenshots

The README gallery screenshots (`docs/screenshots/`) show real data with confidential bits (project/ticket/branch names, message content) CSS-blurred, not synthetic placeholders. Use the `screenshot-curator` subagent (`.claude/agents/screenshot-curator.md`) to (re)capture them — its prompt pins the whole recipe (theme, viewport, per-page selectors, blur process) rather than having it reinvented each time.

## PR / commit instructions

- Conventional Commits (`feat:`, `fix:`, …), imperative mood, scope optional — see `git log` for the house style.
- Never commit without explicit confirmation from the user.
