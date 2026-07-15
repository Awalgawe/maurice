# Changelog

All notable changes to this project are documented in this file. Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [SemVer](https://semver.org/).

## [0.3.0] - 2026-07-15

### Added

- **Agents page** — a `/agents` view joining every `agentType` seen in subagent transcripts with its on-disk definition (`~/.claude/agents`, a project's `.claude/agents`, or an installed plugin), inferring an origin (builtin/custom/plugin/unknown). Same data exposed via `GET /api/agents` and a new MCP `agents` tool.
- **Per-subagent cost** — subagent cost/tokens, previously invisible, are now computed per transcript (own and with descendants) and aggregated onto the session without folding into its own cost. Sessions and subagents now render through one unified, agnostic detail view, with a subagents panel and drill-down navigation.
- **Cost breakdown donut** — the shared "Cost & tokens" panel (session or subagent) gets a small pie chart splitting estimated cost into input, output, cache read, cache write (regular vs. wasted-by-rewrite), and subagents' share.
- **Per-model context window** — context fill % is now computed against each turn's own model window instead of a single global `CONTEXT_WINDOW`, correctly reflecting 1M-window models (Fable, Opus 4.5+, Sonnet 5+). The session chart marks main-thread model switches with dashed vertical lines.

### Changed

- **Topbar config overlay** — the theme, language, and editor selectors are consolidated behind a single icon button that opens a config overlay, decluttering the topbar.

## [0.2.0] - 2026-07-09

### Added

- **Thread forks** — parse rewind-abandoned forked branches from the JSONL logs, expose them via the API/MCP (`branch` param on session detail, `fork`/`uuid`/`index` on search hits), and navigate into/out of a fork from the session detail view with a deep link back to the divergence point.
- **Prompt-cache rewrite detection** — flag billed requests where an idle prompt cache (~5min TTL) or a context edit forced a full context rewrite instead of a cache read. Shown as an inline warning chip on the flagged message, aggregated per session (count + estimated wasted cost) as a sortable column in the sessions list, with a quick-nav panel on the detail page to jump to each flagged message.
- **Inline image rendering** — render base64 image blocks embedded in the thread, both user-uploaded images and images returned by MCP tool results.

### Fixed

- **Responsive layout** — the sessions table and topbar now adapt to narrow windows.

## [0.1.0] - 2026-06-23

### Added

- Initial public release: Dashboard, Sessions, Session detail, Workflow, Timeline, Memories, Plans, Hooks, and Bilans pages.
- Read-only MCP server (`/mcp`) exposing sessions, memories, bilans, and cost data as tools.
