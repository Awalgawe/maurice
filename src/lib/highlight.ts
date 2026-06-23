import hljs from "highlight.js/lib/core";
import langJson       from "highlight.js/lib/languages/json";
import langBash       from "highlight.js/lib/languages/bash";
import langTs         from "highlight.js/lib/languages/typescript";
import langJs         from "highlight.js/lib/languages/javascript";
import langPython     from "highlight.js/lib/languages/python";
import langYaml       from "highlight.js/lib/languages/yaml";
import langDiff       from "highlight.js/lib/languages/diff";
import langSql        from "highlight.js/lib/languages/sql";
import langXml        from "highlight.js/lib/languages/xml";

// Registered once on first import of this module.
hljs.registerLanguage("json",       langJson);
hljs.registerLanguage("bash",       langBash);
hljs.registerLanguage("sh",         langBash);
hljs.registerLanguage("shell",      langBash);
hljs.registerLanguage("typescript", langTs);
hljs.registerLanguage("ts",         langTs);
hljs.registerLanguage("javascript", langJs);
hljs.registerLanguage("js",         langJs);
hljs.registerLanguage("python",     langPython);
hljs.registerLanguage("py",         langPython);
hljs.registerLanguage("yaml",       langYaml);
hljs.registerLanguage("yml",        langYaml);
hljs.registerLanguage("diff",       langDiff);
hljs.registerLanguage("sql",        langSql);
hljs.registerLanguage("xml",        langXml);
hljs.registerLanguage("html",       langXml);

const AUTO_LANGS = ["json", "bash", "typescript", "javascript", "python", "yaml", "diff", "sql", "xml"];

// Cached code highlighting. Key = "lang:code" to handle same snippet in different langs.
// Module-level singleton so highlighting is shared across every message render.
const hlCache = new Map<string, string>();

export function highlightCode(code: string, lang?: string): string | null {
  const key = `${lang ?? ""}:${code}`;
  const cached = hlCache.get(key);
  if (cached !== undefined) return cached;
  let out: string;
  try {
    if (lang && hljs.getLanguage(lang)) {
      out = hljs.highlight(code, { language: lang }).value;
    } else {
      const res = hljs.highlightAuto(code, AUTO_LANGS);
      // Low confidence → return null so the caller lets React escape the raw
      // text. Never return unescaped `code`: it flows into dangerouslySetInnerHTML.
      if (res.relevance <= 5) return null;
      out = res.value;
    }
  } catch {
    return null;
  }
  if (hlCache.size > 300) hlCache.delete(hlCache.keys().next().value as string);
  hlCache.set(key, out);
  return out;
}
