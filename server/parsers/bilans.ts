import fs from "node:fs";
import path from "node:path";
import { CLAUDE_DIR } from "../claudeDir.ts";

const BILANS_DIR = path.join(CLAUDE_DIR, "bilans");

/** `md` bilans are markdown with YAML frontmatter; `html` bilans are standalone
 *  documents carrying their own stylesheet, meant to be rendered as-is. */
export type BilanFormat = "md" | "html";

export interface BilanMeta {
  id: string;
  filename: string;
  format: BilanFormat;
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

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&"); // last: an encoded "&amp;lt;" must not become "<"
}

/** The HTML bilan template embeds the same fields as the markdown frontmatter
 *  (snake_case) in a JSON island in <head>, so both formats expose one shape. */
export function parseHtmlMeta(html: string): Record<string, unknown> {
  const m = /<script[^>]*\bid=["']bilan-meta["'][^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (!m) return {};
  try {
    const parsed: unknown = JSON.parse(m[1]);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** <title> over <h1>: the h1 is an editorial headline (a full sentence), too
 *  long for the list row, while <title> stays a short identifying label. */
export function extractHtmlTitle(html: string): string | null {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const fromTitle = title ? decodeEntities(title[1]).trim() : "";
  if (fromTitle) return fromTitle;
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const fromH1 = h1 ? decodeEntities(h1[1].replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim() : "";
  return fromH1 || null;
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function numOrNull(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
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
  format: BilanFormat;
}

/** Markdown ids drop the extension (they predate HTML bilans and are quoted
 *  back by the MCP read_bilan tool); html ids keep theirs, so a `foo.html`
 *  can never shadow a `foo.md` sitting next to it. */
function idFor(filename: string): string {
  return filename.endsWith(".md") ? filename.slice(0, -3) : filename;
}

function formatOf(filename: string): BilanFormat | null {
  if (filename.endsWith(".md")) return "md";
  if (filename.endsWith(".html")) return "html";
  return null;
}

function collectBilanFiles(): BilanFile[] {
  const files: BilanFile[] = [];

  // Standard location: ~/.claude/bilans/
  try {
    for (const entry of fs.readdirSync(BILANS_DIR, { withFileTypes: true })) {
      const format = entry.isFile() ? formatOf(entry.name) : null;
      if (!format) continue;
      const date = dateFromFilename(entry.name);
      if (!date) continue;
      files.push({
        id: idFor(entry.name),
        filename: entry.name,
        filePath: path.join(BILANS_DIR, entry.name),
        date,
        format,
      });
    }
  } catch { /* dir may not exist yet */ }

  // Legacy: ~/.claude/bilan-*.md (backwards compat with hand-written files)
  try {
    for (const entry of fs.readdirSync(CLAUDE_DIR, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.startsWith("bilan-") || !entry.name.endsWith(".md")) continue;
      const date = dateFromFilename(entry.name);
      if (!date) continue;
      const id = idFor(entry.name);
      if (files.some((f) => f.id === id)) continue;
      files.push({
        id,
        filename: entry.name,
        filePath: path.join(CLAUDE_DIR, entry.name),
        date,
        format: "md",
      });
    }
  } catch { /* ignore */ }

  // Filename tiebreak: same-date bilans (pro / perso / per-project) would
  // otherwise come out in readdir order, which differs between machines.
  return files.sort((a, b) => b.date.localeCompare(a.date) || a.filename.localeCompare(b.filename));
}

function parseBilan(f: BilanFile, content: string): BilanDetail {
  if (f.format === "html") {
    const meta = parseHtmlMeta(content);
    return {
      id: f.id,
      filename: f.filename,
      format: f.format,
      date: f.date,
      periodStart: strOrNull(meta.period_start),
      periodEnd: strOrNull(meta.period_end),
      sessions: numOrNull(meta.sessions),
      costUSD: numOrNull(meta.cost_usd),
      generatedAt: strOrNull(meta.generated_at),
      title: extractHtmlTitle(content) ?? `Bilan ${f.date}`,
      body: content, // whole document — rendered as-is in a sandboxed frame
    };
  }
  const { meta, body } = parseFrontmatter(content);
  return {
    id: f.id,
    filename: f.filename,
    format: f.format,
    date: f.date,
    periodStart: strOrNull(meta.period_start),
    periodEnd: strOrNull(meta.period_end),
    sessions: numOrNull(meta.sessions),
    costUSD: numOrNull(meta.cost_usd),
    generatedAt: strOrNull(meta.generated_at),
    title: extractTitle(body) ?? strOrNull(meta.title) ?? `Bilan ${f.date}`,
    body,
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
    const { body: _body, ...meta } = parseBilan(f, content);
    return [meta];
  });
}

export function readBilan(id: string): BilanDetail | null {
  // Validate id against known files to prevent path traversal
  const f = collectBilanFiles().find((x) => x.id === id);
  if (!f) return null;
  let content: string;
  try {
    content = fs.readFileSync(f.filePath, "utf8");
  } catch {
    return null;
  }
  return parseBilan(f, content);
}
