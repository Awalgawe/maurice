import fs from "node:fs";
import path from "node:path";
import { CLAUDE_DIR, PROJECTS_DIR, decodeProjectId, projectLabel } from "../claudeDir.ts";
import type { MemoryEntry } from "../../src/types.ts";

// Claude Code encodes project paths by replacing "/" and "." with "-".
const GLOBAL_PROJECT_ID = CLAUDE_DIR.replace(/\//g, "-").replace(/\./g, "-");

export function parseFrontmatter(content: string): Omit<MemoryEntry, "projectId" | "projectLabel" | "filename"> | null {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return null;
  const fm = match[1];
  const body = match[2].trim();
  const name = fm.match(/^name:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "") ?? "";
  const description = fm.match(/^description:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "") ?? "";
  const type = fm.match(/^\s+type:\s*(.+)$/m)?.[1]?.trim() ?? "";
  const originSessionId = fm.match(/^\s+originSessionId:\s*(.+)$/m)?.[1]?.trim();
  return { name, description, type, body, ...(originSessionId ? { originSessionId } : {}) };
}

export function listMemories(): MemoryEntry[] {
  const out: MemoryEntry[] = [];
  let projectDirs: string[];
  try {
    projectDirs = fs.readdirSync(PROJECTS_DIR);
  } catch {
    return out;
  }
  for (const projectId of projectDirs) {
    const memDir = path.join(PROJECTS_DIR, projectId, "memory");
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(memDir, { withFileTypes: true });
    } catch {
      continue;
    }
    const label = projectId === GLOBAL_PROJECT_ID ? "~/.claude (global)" : projectLabel(decodeProjectId(projectId));
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith(".md") || e.name === "MEMORY.md") continue;
      let content: string;
      try {
        content = fs.readFileSync(path.join(memDir, e.name), "utf8");
      } catch {
        continue;
      }
      const parsed = parseFrontmatter(content);
      if (!parsed) continue;
      out.push({ ...parsed, filename: e.name, projectId, projectLabel: label });
    }
  }
  out.sort((a, b) => a.projectId.localeCompare(b.projectId) || a.name.localeCompare(b.name));
  return out;
}
