# Changelog

All notable changes to this project are documented in this file. Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [SemVer](https://semver.org/).

## [0.2.0] - 2026-07-09

### Added

- **Thread forks** — parse rewind-abandoned forked branches from the JSONL logs, expose them via the API/MCP (`branch` param on session detail, `fork`/`uuid`/`index` on search hits), and navigate into/out of a fork from the session detail view with a deep link back to the divergence point.
- **Prompt-cache rewrite detection** — flag billed requests where an idle prompt cache (~5min TTL) or a context edit forced a full context rewrite instead of a cache read. Shown as an inline warning chip on the flagged message, aggregated per session (count + estimated wasted cost) as a sortable column in the sessions list, with a quick-nav panel on the detail page to jump to each flagged message.

## [0.1.0] - 2026-06-23

### Added

- Initial public release: Dashboard, Sessions, Session detail, Workflow, Timeline, Memories, Plans, Hooks, and Bilans pages.
- Read-only MCP server (`/mcp`) exposing sessions, memories, bilans, and cost data as tools.
