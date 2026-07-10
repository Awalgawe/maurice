import { useMemo } from "react";
import type { ContentBlock } from "../../types";
import { useT } from "../../hooks/useT";
import { ansiToHtml } from "../../lib/ansi";
import { highlightCode } from "../../lib/highlight";

/** Tool result: peels off a leading system-reminder, highlights JSON, else ANSI. */
export function ToolResultBlock({ b }: { b: Extract<ContentBlock, { kind: "tool_result" }> }) {
  const t = useT();
  const { reminder, body, isJson } = useMemo(() => {
    const raw = b.text.slice(0, 4000);
    const srMatch = raw.match(/^<system-reminder>([\s\S]*?)<\/system-reminder>\n?/);
    const rem = srMatch?.[1]?.trim() ?? null;
    const bd = srMatch ? raw.slice(srMatch[0].length) : raw;
    const trimmed = bd.trimStart();
    const json = (trimmed.startsWith("{") || trimmed.startsWith("[")) && !b.isError;
    return { reminder: rem, body: bd, isJson: json };
  }, [b.text, b.isError]);

  const bodyNode = useMemo(() => {
    if (!body) return null;
    if (isJson) {
      const html = highlightCode(body, "json");
      if (html) {
        return (
          <pre className="json-view">
            <code className="hljs language-json" dangerouslySetInnerHTML={{ __html: html }} />
          </pre>
        );
      }
    }
    return <span dangerouslySetInnerHTML={{ __html: ansiToHtml(body) }} />;
  }, [body, isJson]);

  const hasImages = b.images.length > 0;

  return (
    <>
      <div className={"block tool_result" + (b.isError ? " err" : "")}>
        {reminder && (
          <details className="tool-reminder">
            <summary>⚠ {t("tool_result_reminder")}</summary>
            <span>{reminder}</span>
          </details>
        )}
        {bodyNode ??
          (!reminder && !hasImages && <span className="muted">{t("tool_result_empty")}</span>)}
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
