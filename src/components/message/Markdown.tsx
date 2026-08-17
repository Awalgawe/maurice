import React, { useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { highlightCode } from "../../lib/highlight";
import { CopyButton } from "../ui/CopyButton";

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
// Fenced blocks get their own copy button, independent of the whole-message copy.
// The button lives inside the <pre> (no wrapper element): the pre is the
// containing block and `.md-pre > code` owns the horizontal scroll, so the
// button stays anchored while wide code scrolls under it.
// The text is read back from the DOM because MdCode renders highlighted markup
// via dangerouslySetInnerHTML — the React children are no longer the raw source.
function MdPre({ children }: { children?: React.ReactNode }) {
  const ref = useRef<HTMLPreElement>(null);
  return (
    <pre className="md-pre" ref={ref}>
      {children}
      <CopyButton
        className="copy-float"
        label="code_copy"
        // Unhighlighted blocks keep markdown's trailing newline in the DOM.
        text={() => (ref.current?.querySelector("code")?.textContent ?? "").replace(/\n$/, "")}
      />
    </pre>
  );
}

const MD_COMPONENTS = { code: MdCode, pre: MdPre };

/** Markdown renderer used everywhere prose appears (text blocks, plans, prompts). */
export function Md({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={MD_COMPONENTS}>
      {children}
    </ReactMarkdown>
  );
}
