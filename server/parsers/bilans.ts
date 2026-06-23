import fs from "node:fs";
import path from "node:path";
import { CLAUDE_DIR } from "../claudeDir.ts";

const BILANS_DIR = path.join(CLAUDE_DIR, "bilans");

export interface BilanMeta {
  id: string;
  filename: string;
  date: string;
  periodStart: string | null;
  periodEnd: string | null;
  sessions: number | null;
  costUSD: number | null;
  generatedAt: string | null;
  title: string;
}

export interface BilanDetail extends BilanMeta {
  body: string;
}

function parseFrontmatter(content: string): { meta: Record<string, string>; body: string } {
  if (!content.startsWith("---")) return { meta: {}, body: content };
  const end = content.indexOf("\n---", 3);
  if (end === -1) return { meta: {}, body: content };
  const yamlPart = content.slice(3, end).trim();
  const body = content.slice(end + 4).trimStart();
  const meta: Record<string, string> = {};
  for (const line of yamlPart.split("\n")) {
    const colon = line.indexOf(":");
    if (colon > 0) meta[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return { meta, body };
}

function extractTitle(body: string): string | null {
  const m = /^#\s+(.+)$/m.exec(body);
  return m ? m[1].trim() : null;
}

function dateFromFilename(filename: string): string | null {
  const m = /(\d{4}-\d{2}-\d{2})/.exec(filename);
  return m ? m[1] : null;
}

interface BilanFile {
  id: string;
  filename: string;
  filePath: string;
  date: string;
}

function collectBilanFiles(): BilanFile[] {
  const files: BilanFile[] = [];

  // Standard location: ~/.claude/bilans/
  try {
    for (const entry of fs.readdirSync(BILANS_DIR, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const date = dateFromFilename(entry.name);
      if (!date) continue;
      files.push({
        id: entry.name.replace(/\.md$/, ""),
        filename: entry.name,
        filePath: path.join(BILANS_DIR, entry.name),
        date,
      });
    }
  } catch { /* dir may not exist yet */ }

  // Legacy: ~/.claude/bilan-*.md (backwards compat with hand-written files)
  try {
    for (const entry of fs.readdirSync(CLAUDE_DIR, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.startsWith("bilan-") || !entry.name.endsWith(".md")) continue;
      const date = dateFromFilename(entry.name);
      if (!date) continue;
      const id = entry.name.replace(/\.md$/, "");
      if (files.some((f) => f.id === id)) continue;
      files.push({
        id,
        filename: entry.name,
        filePath: path.join(CLAUDE_DIR, entry.name),
        date,
      });
    }
  } catch { /* ignore */ }

  return files.sort((a, b) => b.date.localeCompare(a.date));
}

function buildMeta(f: BilanFile, content: string): BilanMeta {
  const { meta, body } = parseFrontmatter(content);
  const title = extractTitle(body) ?? meta.title ?? `Bilan ${f.date}`;
  return {
    id: f.id,
    filename: f.filename,
    date: f.date,
    periodStart: meta.period_start ?? null,
    periodEnd: meta.period_end ?? null,
    sessions: meta.sessions ? Number(meta.sessions) : null,
    costUSD: meta.cost_usd ? Number(meta.cost_usd) : null,
    generatedAt: meta.generated_at ?? null,
    title,
  };
}

export function listBilans(): BilanMeta[] {
  return collectBilanFiles().flatMap((f) => {
    let content: string;
    try {
      content = fs.readFileSync(f.filePath, "utf8");
    } catch {
      return [];
    }
    return [buildMeta(f, content)];
  });
}

export function readBilan(id: string): BilanDetail | null {
  // Validate id against known files to prevent path traversal
  const files = collectBilanFiles();
  const f = files.find((x) => x.id === id);
  if (!f) return null;
  let content: string;
  try {
    content = fs.readFileSync(f.filePath, "utf8");
  } catch {
    return null;
  }
  const { meta, body } = parseFrontmatter(content);
  const title = extractTitle(body) ?? meta.title ?? `Bilan ${f.date}`;
  return {
    id: f.id,
    filename: f.filename,
    date: f.date,
    periodStart: meta.period_start ?? null,
    periodEnd: meta.period_end ?? null,
    sessions: meta.sessions ? Number(meta.sessions) : null,
    costUSD: meta.cost_usd ? Number(meta.cost_usd) : null,
    generatedAt: meta.generated_at ?? null,
    title,
    body,
  };
}
