import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Point CLAUDE_DIR at a throwaway dir BEFORE bilans.ts binds BILANS_DIR.
vi.hoisted(() => {
  process.env.CLAUDE_DIR =
    (process.env.TMPDIR || "/tmp").replace(/\/+$/, "") + "/maurice-bilans-" + process.pid + "/.claude";
});

import { listBilans, readBilan, parseHtmlMeta, extractHtmlTitle } from "./bilans.ts";

const ROOT = process.env.CLAUDE_DIR as string;
const BILANS = path.join(ROOT, "bilans");

// Trimmed to the parts the parser reads: the JSON island, <title>, and the
// editorial <h1> the real template puts in <body>.
const HTML_BILAN = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Bilan de sprint &middot; 04 &rarr; 17.08.2026 &amp; co</title>

<script type="application/json" id="bilan-meta">
{
  "period_start": "2026-08-04",
  "period_end": "2026-08-17",
  "scope": "pro",
  "sessions": 34,
  "cost_usd": 499.28,
  "generated_at": "2026-08-17T08:37:48Z"
}
</script>
<style>body { color: red }</style>
</head>
<body>
<h1>Un seul ticket a mangé le sprint</h1>
<script>document.getElementById("tt").onclick = () => {};</script>
</body>
</html>`;

const MD_BILAN = [
  "---",
  "period_start: 2026-08-01",
  "period_end: 2026-08-12",
  "sessions: 7",
  "cost_usd: 12.5",
  "generated_at: 2026-08-12T09:58:00Z",
  "---",
  "# Bilan markdown",
  "",
  "Corps du bilan.",
].join("\n");

beforeAll(() => {
  fs.mkdirSync(BILANS, { recursive: true });
  fs.writeFileSync(path.join(BILANS, "bilan-2026-08-17.html"), HTML_BILAN);
  fs.writeFileSync(path.join(BILANS, "bilan-2026-08-17-perso.html"), HTML_BILAN);
  fs.writeFileSync(path.join(BILANS, "bilan-2026-08-12-prefixe-skills.md"), MD_BILAN);
  fs.writeFileSync(path.join(BILANS, "notes.txt"), "not a bilan");
  fs.writeFileSync(path.join(BILANS, "bilan-sans-date.html"), HTML_BILAN);
});

afterAll(() => {
  fs.rmSync(path.dirname(ROOT), { recursive: true, force: true });
});

describe("parseHtmlMeta", () => {
  it("reads the bilan-meta JSON island", () => {
    expect(parseHtmlMeta(HTML_BILAN)).toMatchObject({
      period_start: "2026-08-04",
      sessions: 34,
      cost_usd: 499.28,
    });
  });

  it("returns {} when the island is missing or malformed", () => {
    expect(parseHtmlMeta("<html><head></head></html>")).toEqual({});
    expect(parseHtmlMeta('<script type="application/json" id="bilan-meta">{ nope</script>')).toEqual({});
    expect(parseHtmlMeta('<script type="application/json" id="bilan-meta">[1,2]</script>')).toEqual({});
  });
});

describe("extractHtmlTitle", () => {
  it("prefers <title> and decodes entities", () => {
    expect(extractHtmlTitle(HTML_BILAN)).toBe("Bilan de sprint &middot; 04 &rarr; 17.08.2026 & co");
  });

  it("falls back to the <h1> when <title> is absent or empty", () => {
    expect(extractHtmlTitle("<html><body><h1>Une <em>manchette</em></h1></body></html>")).toBe("Une manchette");
    expect(extractHtmlTitle("<html><head><title>  </title></head><body><h1>Titre h1</h1></body></html>")).toBe("Titre h1");
  });

  it("returns null when there is neither", () => {
    expect(extractHtmlTitle("<html><body><p>rien</p></body></html>")).toBeNull();
  });
});

describe("listBilans", () => {
  it("lists html and md bilans, newest first, filename as tiebreak", () => {
    expect(listBilans().map((b) => b.id)).toEqual([
      "bilan-2026-08-17-perso.html",
      "bilan-2026-08-17.html",
      "bilan-2026-08-12-prefixe-skills",
    ]);
  });

  it("skips non-bilan extensions and files without a date", () => {
    const ids = listBilans().map((b) => b.id);
    expect(ids).not.toContain("notes.txt");
    expect(ids.some((id) => id.startsWith("bilan-sans-date"))).toBe(false);
  });

  it("exposes html metadata from the JSON island", () => {
    const html = listBilans().find((b) => b.id === "bilan-2026-08-17.html");
    expect(html).toMatchObject({
      format: "html",
      date: "2026-08-17",
      periodStart: "2026-08-04",
      periodEnd: "2026-08-17",
      sessions: 34,
      costUSD: 499.28,
      generatedAt: "2026-08-17T08:37:48Z",
    });
  });

  it("keeps markdown ids extension-free and reads their frontmatter", () => {
    const md = listBilans().find((b) => b.format === "md");
    expect(md).toMatchObject({
      id: "bilan-2026-08-12-prefixe-skills",
      title: "Bilan markdown",
      sessions: 7,
      costUSD: 12.5,
    });
  });
});

describe("readBilan", () => {
  it("returns the whole document for an html bilan", () => {
    const detail = readBilan("bilan-2026-08-17.html");
    expect(detail?.format).toBe("html");
    expect(detail?.body).toBe(HTML_BILAN);
  });

  it("returns the frontmatter-stripped body for an md bilan", () => {
    const detail = readBilan("bilan-2026-08-12-prefixe-skills");
    expect(detail?.format).toBe("md");
    expect(detail?.body).toBe("# Bilan markdown\n\nCorps du bilan.");
  });

  it("rejects unknown ids and path traversal", () => {
    expect(readBilan("bilan-2026-08-17")).toBeNull(); // html id keeps its extension
    expect(readBilan("../../etc/passwd")).toBeNull();
  });
});
