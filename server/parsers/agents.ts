import fs from "node:fs";
import path from "node:path";
import { CLAUDE_DIR } from "../claudeDir.ts";
import { emptyTokens } from "./jsonl.ts";
import type { AgentDefinition, AgentOrigin, AgentRow, AgentSource, AgentUsage, SessionMeta, TokenTotals } from "../../src/types.ts";

// Kept as a local alias: this file is the only producer of registry entries.
type DefinedAgent = AgentDefinition;

interface ParsedFrontmatter {
  name: string;
  description: string;
  model: string | null;
  color: string | null;
  tools: string[] | null;
}

function stripQuotes(s: string): string {
  return s.trim().replace(/^["']|["']$/g, "");
}

function parseToolsValue(raw: string | undefined): string[] | null {
  if (raw === undefined) return null;
  const cleaned = raw.trim().replace(/^\[|\]$/g, "");
  if (!cleaned) return [];
  return cleaned
    .split(",")
    .map((s) => stripQuotes(s))
    .filter(Boolean);
}

/**
 * Minimal YAML frontmatter reader for agent .md files: flat top-level keys
 * only (agent frontmatter never nests), tolerant of folded (">") and literal
 * ("|") block scalars — agent `description` fields are often long
 * trigger-condition prose spanning many lines. Not a general YAML parser.
 */
export function parseAgentFrontmatter(content: string): ParsedFrontmatter | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return null;
  const lines = match[1].split(/\r?\n/);
  const fields: Record<string, string> = {};
  let i = 0;
  while (i < lines.length) {
    const kv = lines[i].match(/^([A-Za-z_][\w-]*):[ \t]?(.*)$/);
    if (!kv) {
      i++;
      continue;
    }
    const key = kv[1];
    let value = kv[2].trim();
    i++;
    if (value === "" || value === ">-" || value === ">" || value === "|-" || value === "|") {
      const folded = value.startsWith(">");
      const block: string[] = [];
      while (i < lines.length && (lines[i].trim() === "" || /^\s/.test(lines[i]))) {
        block.push(lines[i]);
        i++;
      }
      const indented = block.filter((l) => l.trim() !== "");
      const minIndent = indented.length ? Math.min(...indented.map((l) => l.match(/^\s*/)![0].length)) : 0;
      value = block
        .map((l) => l.slice(minIndent))
        .join(folded ? " " : "\n")
        .trim();
    }
    fields[key] = value;
  }
  if (!fields.name) return null;
  return {
    name: stripQuotes(fields.name),
    description: stripQuotes(fields.description ?? ""),
    model: fields.model ? stripQuotes(fields.model) : null,
    color: fields.color ? stripQuotes(fields.color) : null,
    tools: parseToolsValue(fields.tools),
  };
}

function readMarkdownFiles(dir: string): { file: string; content: string }[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: { file: string; content: string }[] = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith(".md")) continue;
    const filePath = path.join(dir, e.name);
    try {
      out.push({ file: filePath, content: fs.readFileSync(filePath, "utf8") });
    } catch {
      /* unreadable, skip */
    }
  }
  return out;
}

function parseAgentsIn(
  dir: string,
  source: AgentSource,
  namePrefix: string | null,
  projectId: string | null,
  projectLabel: string | null,
): DefinedAgent[] {
  const out: DefinedAgent[] = [];
  for (const { file, content } of readMarkdownFiles(dir)) {
    const fm = parseAgentFrontmatter(content);
    if (!fm) {
      console.warn(`[agents] malformed frontmatter, skipping: ${file}`);
      continue;
    }
    out.push({
      name: namePrefix ? `${namePrefix}:${fm.name}` : fm.name,
      description: fm.description,
      model: fm.model,
      color: fm.color,
      tools: fm.tools,
      source,
      filePath: file,
      projectId,
      projectLabel,
    });
  }
  return out;
}

/**
 * Scan every agent-definition source reachable from the current index: the
 * user registry (~/.claude/agents), each known project's own registry
 * (<projectPath>/.claude/agents, deduped by resolved path so many sessions of
 * the same project aren't re-scanned), and installed plugins (namespaced
 * "plugin:name" — the same convention Claude Code uses for agentType). A
 * project whose projectPath no longer exists on disk yields no entries — this
 * is a point-in-time view, not a durable index, and that's an accepted
 * limitation (surfaced in the UI via the "unknown" origin badge).
 */
export function listDefinedAgents(index: SessionMeta[]): DefinedAgent[] {
  const out: DefinedAgent[] = [];

  out.push(...parseAgentsIn(path.join(CLAUDE_DIR, "agents"), "user", null, null, null));

  const seenProjectDirs = new Set<string>();
  for (const s of index) {
    if (!s.projectPath) continue;
    const dir = path.resolve(s.projectPath, ".claude", "agents");
    if (seenProjectDirs.has(dir)) continue;
    seenProjectDirs.add(dir);
    out.push(...parseAgentsIn(dir, "project", null, s.projectId, s.projectLabel));
  }

  const pluginsCacheDir = path.join(CLAUDE_DIR, "plugins", "cache");
  let marketplaces: string[];
  try {
    marketplaces = fs.readdirSync(pluginsCacheDir);
  } catch {
    marketplaces = [];
  }
  for (const marketplace of marketplaces) {
    const marketplaceDir = path.join(pluginsCacheDir, marketplace);
    let plugins: string[];
    try {
      plugins = fs.readdirSync(marketplaceDir);
    } catch {
      continue;
    }
    for (const plugin of plugins) {
      const pluginDir = path.join(marketplaceDir, plugin);
      let versions: string[];
      try {
        versions = fs.readdirSync(pluginDir);
      } catch {
        continue;
      }
      for (const version of versions) {
        out.push(...parseAgentsIn(path.join(pluginDir, version, "agents"), "plugin", plugin, null, null));
      }
    }
  }

  return out;
}

// Claude Code's shipped agentType values — no field marks these as built-in,
// so this list is a hardcoded snapshot that drifts across Claude Code versions.
const BUILTIN_AGENT_TYPES = new Set([
  "Explore",
  "Plan",
  "general-purpose",
  "claude",
  "claude-code-guide",
  "statusline-setup",
  "workflow-subagent",
  "fork",
]);

/**
 * Best-effort origin inference for an agentType: a subagent's .meta.json
 * carries no origin flag, so this is inferred from the name and the scanned
 * registry. Order matters: a plugin-namespaced name ("plugin:agent") is
 * unambiguous; anything found in the user/project registry is custom; the
 * built-in list is checked last.
 */
export function classifyAgentType(name: string, registry: DefinedAgent[]): AgentOrigin {
  if (name.includes(":")) return "plugin";
  if (registry.some((a) => a.source !== "plugin" && a.name === name)) return "custom";
  if (BUILTIN_AGENT_TYPES.has(name)) return "builtin";
  return "unknown";
}

function addTokens(dst: TokenTotals, src: TokenTotals): void {
  dst.input += src.input;
  dst.output += src.output;
  dst.cacheRead += src.cacheRead;
  dst.cacheCreate += src.cacheCreate;
}

/**
 * Build the /agents view: every registry definition joined with its usage
 * aggregate (from each session's `subagentsByType`), by name. Either side of a
 * row may be empty — a defined-never-used agent has `usage: null`; an
 * agentType with no matching registry entry (built-in, or a project whose
 * .claude/agents no longer exists) has `definitions: []`. Not cached: this is
 * a handful of readdir + tiny frontmatter parses, negligible per request.
 */
export function buildAgentRows(index: SessionMeta[]): AgentRow[] {
  const registry = listDefinedAgents(index);
  const definitionsByName = new Map<string, AgentDefinition[]>();
  for (const d of registry) {
    const arr = definitionsByName.get(d.name);
    if (arr) arr.push(d);
    else definitionsByName.set(d.name, [d]);
  }

  const usageByName = new Map<string, AgentUsage>();
  for (const s of index) {
    if (!s.subagentsByType) continue;
    for (const [agentType, bucket] of Object.entries(s.subagentsByType)) {
      let u = usageByName.get(agentType);
      if (!u) usageByName.set(agentType, (u = { runs: 0, sessions: 0, costUSD: 0, tokens: emptyTokens(), lastUsed: null }));
      u.runs += bucket.count;
      u.sessions += 1;
      u.costUSD += bucket.costUSD;
      addTokens(u.tokens, bucket.tokens);
      if (s.end && (!u.lastUsed || s.end > u.lastUsed)) u.lastUsed = s.end;
    }
  }

  const names = new Set<string>([...definitionsByName.keys(), ...usageByName.keys()]);
  const rows: AgentRow[] = [...names].map((name) => ({
    name,
    origin: classifyAgentType(name, registry),
    definitions: definitionsByName.get(name) ?? [],
    usage: usageByName.get(name) ?? null,
  }));
  rows.sort((a, b) => (b.usage?.costUSD ?? 0) - (a.usage?.costUSD ?? 0) || a.name.localeCompare(b.name));
  return rows;
}
