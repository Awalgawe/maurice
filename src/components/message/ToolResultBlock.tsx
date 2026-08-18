import { useMemo, useState } from "react";
import type { ContentBlock } from "../../types";
import { useT } from "../../hooks/useT";
import { ansiToHtml } from "../../lib/ansi";
import { highlightCode } from "../../lib/highlight";
import { CopyButton } from "../ui/CopyButton";

// Long outputs are collapsed to a preview so a huge tool_result doesn't blow up
// the thread — but the full text is always reachable via the toggle, never
// silently dropped. Highlighting/ANSI runs on the sliced text (not the rendered
// HTML) so a collapse can't cut through a tag.
const PREVIEW_LEN = 4000;

/** Tool result: peels off a leading system-reminder, highlights JSON, else ANSI. */
export function ToolResultBlock({ b }: { b: Extract<ContentBlock, { kind: "tool_result" }> }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const { reminder, body, isJson } = useMemo(() => {
    const raw = b.text;
    const srMatch = raw.match(/^<system-reminder>([\s\S]*?)<\/system-reminder>\n?/);
    const rem = srMatch?.[1]?.trim() ?? null;
    const bd = srMatch ? raw.slice(srMatch[0].length) : raw;
    const trimmed = bd.trimStart();
    const json = (trimmed.startsWith("{") || trimmed.startsWith("[")) && !b.isError;
    return { reminder: rem, body: bd, isJson: json };
  }, [b.text, b.isError]);

  const truncated = body.length > PREVIEW_LEN;
  const shown = expanded || !truncated ? body : body.slice(0, PREVIEW_LEN);

  const bodyNode = useMemo(() => {
    if (!shown) return null;
    if (isJson) {
      const html = highlightCode(shown, "json");
      if (html) {
        return (
          <pre className="json-view">
            <code className="hljs language-json" dangerouslySetInnerHTML={{ __html: html }} />
          </pre>
        );
      }
    }
    return <span dangerouslySetInnerHTML={{ __html: ansiToHtml(shown) }} />;
  }, [shown, isJson]);

  const hasImages = b.images.length > 0;

  return (
    <>
      {/* The block itself is the scroller (max-height), so the button is anchored
          to a wrapper — otherwise it scrolls away with the output. */}
      <div className="copy-host">
        <div className={"block tool_result" + (b.isError ? " err" : "")}>
          {reminder && (
            <details className="tool-reminder">
              <summary>⚠ {t("tool_result_reminder")}</summary>
              <span>{reminder}</span>
            </details>
          )}
          {bodyNode ??
            (!reminder && !hasImages && <span className="muted">{t("tool_result_empty")}</span>)}
          {truncated && (
            <div className="tool-result-more">
              {!expanded && <span className="muted">{t("tool_result_truncated")}</span>}
              <button type="button" className="tool-result-toggle" onClick={() => setExpanded((v) => !v)}>
                {expanded ? t("tool_result_collapse") : t("tool_result_show_all")}
              </button>
            </div>
          )}
        </div>
        {/* Copies the whole body, not the 4000-char preview. */}
        {body && <CopyButton className="copy-float" label="code_copy_output" text={body} />}
      </div>
      {hasImages && (
        <div className="block image tool-result-images">
          {b.images.map((img, i) => (
            <img
              key={i}
              src={`data:${img.mediaType};base64,${img.data}`}
              alt={t("block_image_alt")}
            />
          ))}
        </div>
      )}
    </>
  );
}
