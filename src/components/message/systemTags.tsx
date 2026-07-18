import React, { useMemo } from "react";
import { ansiToHtml } from "../../lib/ansi";
import { editorLabel, useEditor } from "../../state/EditorContext";
import { useT } from "../../hooks/useT";
import { Md } from "./Markdown";

// Matches any known system tag (the `g` flag means callers must reset lastIndex).
const SYSTEM_TAG_RE = /<(ide_opened_file|command-name|command-args|command-message|local-command-stdout|local-command-caveat)>([\s\S]*?)<\/\1>/g;

function IdeOpenedFile({ content }: { content: string }) {
  const { editor } = useEditor();
  const t = useT();
  const label = editorLabel(editor, t);
  const openTitle = t("editor_open_in", { editor: label });
  const { filePath, fileName } = useMemo(() => {
    const match = content.match(/The user opened the file (.+?) in the IDE/);
    const fp = match?.[1] ?? content.trim();
    return { filePath: fp, fileName: fp.split("/").pop() || fp };
  }, [content]);
  return (
    <span className="ide-file-tag">
      📄 <a href={`file://${filePath}`} title={filePath}>{fileName}</a>
      {editor.url ? (
        <a className="ide-file-open" href={editor.url(filePath)} title={openTitle}>
          {label}
        </a>
      ) : (
        <button className="ide-file-open" title={openTitle}
          onClick={() => fetch("/api/open", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: filePath }),
          })}>
          {label}
        </button>
      )}
    </span>
  );
}

function CommandTag({ name, args }: { name: string; args: string }) {
  const label = (name.startsWith("/") ? name : "/" + name) + (args ? " " + args : "");
  return <span className="cmd-tag">⚡ {label}</span>;
}

function CommandStdout({ content }: { content: string }) {
  return (
    <span
      className="cmd-stdout"
      dangerouslySetInnerHTML={{ __html: ansiToHtml(content.trim()) }}
    />
  );
}

/** Memoized text renderer: parses system tags out, renders the rest as Markdown. */
export function TextBlock({ text }: { text: string }) {
  return useMemo(() => buildTextNodes(text), [text]);
}

function buildTextNodes(text: string): React.ReactNode {
  SYSTEM_TAG_RE.lastIndex = 0;
  if (!SYSTEM_TAG_RE.test(text)) return <Md>{text}</Md>;

  // Collect all tag matches
  const matches: { index: number; end: number; tag: string; content: string }[] = [];
  SYSTEM_TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SYSTEM_TAG_RE.exec(text)) !== null) {
    matches.push({ index: m.index, end: m.index + m[0].length, tag: m[1], content: m[2] });
  }

  const nodes: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  let i = 0;
  while (i < matches.length) {
    const { index, end, tag, content } = matches[i];
    if (index > last) {
      const between = text.slice(last, index);
      if (between.trim()) nodes.push(<Md key={key++}>{between}</Md>);
    }
    if (tag === "command-name") {
      // Consume following command-message / command-args (skipping whitespace-only gaps)
      let args = "";
      let j = i + 1;
      while (j < matches.length) {
        const gap = text.slice(matches[j - 1].end, matches[j].index);
        if (gap.trim()) break;
        if (matches[j].tag === "command-message") { j++; continue; } // skip, redundant
        if (matches[j].tag === "command-args") { args = matches[j].content.trim(); j++; break; }
        break;
      }
      nodes.push(<CommandTag key={key++} name={content.trim()} args={args} />);
      last = matches[j - 1]?.end ?? end;
      i = j;
      continue;
    }
    if (tag === "command-message" || tag === "command-args") {
      // Orphaned (not consumed above) — skip silently
    } else if (tag === "local-command-stdout") {
      nodes.push(<CommandStdout key={key++} content={content} />);
    } else if (tag === "local-command-caveat") {
      if (content.trim()) nodes.push(<span key={key++} className="muted cmd-caveat">{content.trim()}</span>);
    } else if (tag === "ide_opened_file") {
      nodes.push(<IdeOpenedFile key={key++} content={content} />);
    }
    last = end;
    i++;
  }
  if (last < text.length) {
    const tail = text.slice(last);
    if (tail.trim()) nodes.push(<Md key={key++}>{tail}</Md>);
  }
  return <>{nodes}</>;
}
