import os from "node:os";
import path from "node:path";
import fs from "node:fs";

/** Root Claude directory we read from. Read-only — we never write here. */
export const CLAUDE_DIR =
  process.env.CLAUDE_DIR || path.join(os.homedir(), ".claude");

export const PROJECTS_DIR = path.join(CLAUDE_DIR, "projects");

/** Context window size used for the fill ratio (Claude default is 200k). */
export const CONTEXT_WINDOW = Number(process.env.CONTEXT_WINDOW || 200_000);

export interface SessionFile {
  id: string; // sessionId (basename without .jsonl)
  projectId: string; // encoded project dir name
  filePath: string;
  size: number;
  mtimeMs: number;
}

/** List every <project>/<sessionId>.jsonl file under projects/. */
export function listSessionFiles(): SessionFile[] {
  const out: SessionFile[] = [];
  let projectDirs: string[];
  try {
    projectDirs = fs.readdirSync(PROJECTS_DIR);
  } catch {
    return out;
  }
  for (const projectId of projectDirs) {
    const projectPath = path.join(PROJECTS_DIR, projectId);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(projectPath);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(projectPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith(".jsonl")) continue;
      const filePath = path.join(projectPath, e.name);
      let s: fs.Stats;
      try {
        s = fs.statSync(filePath);
      } catch {
        continue;
      }
      out.push({
        id: e.name.replace(/\.jsonl$/, ""),
        projectId,
        filePath,
        size: s.size,
        mtimeMs: s.mtimeMs,
      });
    }
  }
  return out;
}

export function sessionFilePath(projectId: string, id: string): string {
  return path.join(PROJECTS_DIR, projectId, `${id}.jsonl`);
}

export function subagentsDir(projectId: string, id: string): string {
  return path.join(PROJECTS_DIR, projectId, id, "subagents");
}

/**
 * Stat-only fingerprint of a session's subagents dir (Σ per-transcript
 * size + mtime over every `*.jsonl`, recursively — workflow agents nest under
 * `workflows/<wf_id>/`). Cheap (readdir + statSync, no content read). Changes
 * whenever a transcript is added, removed or grows — so cost/token aggregates
 * keyed on it aren't served stale when a background subagent finishes after
 * the parent session file's last write. "" when there is no subagents dir.
 * Skips journal.jsonl like the parser (an event log, not a transcript).
 */
export function subagentsFingerprint(projectId: string, id: string): string {
  const dir = subagentsDir(projectId, id);
  let files: fs.Dirent[];
  try {
    files = fs.readdirSync(dir, { withFileTypes: true, recursive: true });
  } catch {
    return "";
  }
  const parts: string[] = [];
  for (const f of files) {
    if (!f.isFile() || !f.name.endsWith(".jsonl") || f.name === "journal.jsonl") continue;
    const abs = path.join(f.parentPath, f.name);
    const rel = path.relative(dir, abs).split(path.sep).join("/");
    try {
      const s = fs.statSync(abs);
      parts.push(`${rel}:${s.size}:${s.mtimeMs}`);
    } catch {
      /* vanished between readdir and stat */
    }
  }
  return parts.sort().join("|");
}

/**
 * Best-effort decode of the encoded project dir name into a readable path.
 * Encoding replaces "/" with "-", which collides with real hyphens, so this
 * is only a fallback — prefer the cwd captured inside the session file.
 */
export function decodeProjectId(projectId: string): string {
  return projectId.replace(/^-/, "/").replace(/-/g, "/");
}

/** Short label: last 1-2 segments of the readable project path. */
export function projectLabel(projectPath: string): string {
  const parts = projectPath.split("/").filter(Boolean);
  if (parts.length <= 2) return parts.join("/");
  return parts.slice(-2).join("/");
}
