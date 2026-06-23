import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { highlightCode } from "../../lib/highlight";

// GitHub-Flavored Markdown (tables, strikethrough, task lists, autolinks).
// Module-level so the plugin array / component map aren't recreated per render
// (recreating `components` would force ReactMarkdown to remount its renderer).
const REMARK_PLUGINS = [remarkGfm];

// Custom code renderer: highlight recognised languages, pass through the rest.
function MdCode({ className, children }: { className?: string; children?: React.ReactNode }) {
  const lang = /language-(\w+)/.exec(className || "")?.[1];
  const code = String(children ?? "").replace(/\n$/, "");
  const highlighted = highlightCode(code, lang);
  if (highlighted) {
    return (
      <code
        className={"hljs" + (lang ? ` language-${lang}` : "")}
        dangerouslySetInnerHTML={{ __html: highlighted }}
      />
    );
  }
  return <code className={className}>{children}</code>;
}
const MD_COMPONENTS = { code: MdCode };

/** Markdown renderer used everywhere prose appears (text blocks, plans, prompts). */
export function Md({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={MD_COMPONENTS}>
      {children}
    </ReactMarkdown>
  );
}
