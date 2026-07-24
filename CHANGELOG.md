# Changelog

All notable changes to this project are documented in this file. Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [SemVer](https://semver.org/).

## [0.4.0] - 2026-07-25

### Added

- **Claude-generated session titles** — the standalone `ai-title` line most sessions carry is now surfaced as the leading title everywhere (Sessions, Workflow, Dashboard, Session detail, MCP list/search), falling back to the first user prompt when absent.
- **Turn durations & API reliability** — real wall-clock turn durations (`turn_duration` lines) power an active-time and average-turn readout on the Dashboard and a sortable time-per-group column in Workflow; API retries and error placeholders feed a new API-reliability panel.
- **Friction & behavior metrics** — a Dashboard panel split into obstacles (interruptions, tool denials per-kind) and habits (permission-mode changes, prompt provenance typed / SDK / other), parsed from structured signals on user lines.
- **Hooks execution analytics** — the Hooks page gains an executions table (fires, average latency, async responses, errors, sessions) aggregated from hook attachment lines, merged with the existing `settings.json` config view. Numbers only — command/stdout/stderr are never stored.
- **Per-tool analytics, compaction markers & files touched** — per-session usage and error counts for every tool (not just MCP) drive a Dashboard top-tools panel; `compact_boundary` lines become amber dashed markers on the detail context curve; file-history snapshots become a files-touched count on the detail panel.

### Fixed

- **Cache-write pricing per TTL tier** — cache creation is now priced from its `ephemeral_5m` / `ephemeral_1h` split instead of billing every write at the 5-minute rate, which undercosted 1-hour writes by ~60%.
- **Detail token accuracy** — per-message tokens are attributed to a request's first JSONL line only, so multi-block turns no longer over-count; denials and rewrite causes now read structured fields.
- **Nested subagent discovery** — workflow-spawned agent transcripts nested under `subagents/workflows/` are now discovered recursively.
- **Cost bar underfill** — stacked cost bars for sub-$1 totals now fill completely (grow factors normalized to sum to 1).

## [0.3.0] - 2026-07-16

### Added

- **Agents page** — a `/agents` view joining every `agentType` seen in subagent transcripts with its on-disk definition (`~/.claude/agents`, a project's `.claude/agents`, or an installed plugin), inferring an origin (builtin/custom/plugin/unknown). Same data exposed via `GET /api/agents` and a new MCP `agents` tool.
- **Per-subagent cost** — subagent cost/tokens, previously invisible, are now computed per transcript (own and with descendants) and aggregated onto the session without folding into its own cost. Sessions and subagents now render through one unified, agnostic detail view, with a subagents panel and drill-down navigation.
- **Cost breakdown table** — the shared "Cost & tokens" panel (session or subagent) gets a merged tokens+cost table with a small stacked bar strip, splitting estimated cost into input, output, cache read, cache write (regular vs. wasted-by-rewrite), and subagents' share.
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
