import fs from "node:fs";
import path from "node:path";
import { CLAUDE_DIR, projectLabel } from "../claudeDir.ts";
import { getIndex } from "../cache.ts";
import type { PlanEntry } from "../../src/types.ts";

/** Sentinel projectId for plans living in ~/.claude/plans/ (not tied to a repo). */
export const GLOBAL_PLANS_ID = "__global__";
export const GLOBAL_PLANS_DIR = path.join(CLAUDE_DIR, "plans");

/** First markdown "# heading" of a plan, or null. */
export function extractTitle(content: string): string | null {
  const m = content.match(/^#\s+(.+?)\s*$/m);
  return m ? m[1].trim() : null;
}

const FILENAME_TICKET_RE = /^([a-z]{2,}-\d+)/i; // ticket key at the start of the filename
const TITLE_TICKET_RE = /\b([A-Z]{2,}-\d+)\b/; // uppercase-only, to avoid matching "Opus-4" etc.

/** Ticket key for grouping/display, from the filename (preferred) or the title. Uppercased. */
export function extractTicket(filename: string, title: string): string | null {
  return (filename.match(FILENAME_TICKET_RE)?.[1] ?? title.match(TITLE_TICKET_RE)?.[1])?.toUpperCase() ?? null;
}

/** Plans directory for a project, given its real cwd (decodeProjectId is lossy — pass the captured cwd). */
export function plansDirForProject(projectPath: string): string {
  return path.join(projectPath, ".claude", "plans");
}

/** Read every *.md under one plans directory into PlanEntry rows. Missing dir → []. */
function readPlansDir(
  dir: string,
  scope: PlanEntry["scope"],
  projectId: string,
  label: string,
): PlanEntry[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: PlanEntry[] = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith(".md")) continue;
    const filePath = path.join(dir, e.name);
    let content: string;
    let mtimeMs: number;
    try {
      content = fs.readFileSync(filePath, "utf8");
      mtimeMs = fs.statSync(filePath).mtimeMs;
    } catch {
      continue;
    }
    const title = extractTitle(content) ?? e.name.replace(/\.md$/, "");
    out.push({
      filename: e.name,
      title,
      scope,
      projectId,
      projectLabel: label,
      mtimeMs,
      body: content,
      ticket: extractTicket(e.name, title),
    });
  }
  return out;
}

/**
 * List plan-mode markdown files from ~/.claude/plans/ (global) and every known
 * project's <cwd>/.claude/plans/. Project paths come from the session index's
 * captured cwd, never from the lossy decodeProjectId. Sorted by mtime desc.
 */
export async function listPlans(): Promise<PlanEntry[]> {
  const out: PlanEntry[] = readPlansDir(GLOBAL_PLANS_DIR, "global", GLOBAL_PLANS_ID, "~/.claude (global)");

  const index = await getIndex();
  const seen = new Map<string, string>(); // projectId -> projectPath
  for (const s of index) {
    if (s.projectPath && !seen.has(s.projectId)) seen.set(s.projectId, s.projectPath);
  }
  // A session run from $HOME resolves <cwd>/.claude/plans to the global dir —
  // skip it so those files aren't listed twice (once global, once project).
  const globalDir = path.resolve(GLOBAL_PLANS_DIR);
  const seenDirs = new Set<string>([globalDir]);
  for (const [projectId, projectPath] of seen) {
    const dir = path.resolve(plansDirForProject(projectPath));
    if (seenDirs.has(dir)) continue;
    seenDirs.add(dir);
    out.push(...readPlansDir(dir, "project", projectId, projectLabel(projectPath)));
  }

  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out;
}

/** A filename is a single safe markdown basename (no separators, no traversal). */
export function isSafePlanFilename(name: unknown): name is string {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    name.endsWith(".md") &&
    !name.includes("..") &&
    !/[/\\]/.test(name)
  );
}

/**
 * Resolve the absolute path of a plan, confined to its plans directory.
 * For project scope, pass the trusted projectPath (resolved server-side from the
 * index, never from the client). Returns null if anything is unsafe.
 */
export function resolvePlanPath(
  scope: string,
  filename: string,
  projectPath?: string,
): string | null {
  if (!isSafePlanFilename(filename)) return null;
  let base: string;
  if (scope === "global") {
    base = GLOBAL_PLANS_DIR;
  } else if (scope === "project") {
    if (!projectPath) return null;
    base = plansDirForProject(projectPath);
  } else {
    return null;
  }
  const resolved = path.resolve(base, filename);
  if (resolved !== path.join(base, filename)) return null;
  if (!resolved.startsWith(path.resolve(base) + path.sep)) return null;
  return resolved;
}

/** Real cwd for an encoded projectId, from the session index. Null if unknown. */
export async function resolveProjectPath(projectId: string): Promise<string | null> {
  const index = await getIndex();
  return index.find((s) => s.projectId === projectId && s.projectPath)?.projectPath ?? null;
}
