import { useState } from "react";
import { useT, type I18nKey } from "../../hooks/useT";

const IconCopy = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="5" y="5" width="9" height="9" rx="1.5" />
    <path d="M11 5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2" />
  </svg>
);

const IconCheck = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 8.5l3.5 3.5L13 5" />
  </svg>
);

/**
 * Copy-to-clipboard button for one block. `text` may be a thunk when the value
 * only exists in the DOM (highlighted markup) or is expensive to build.
 * Always copies the FULL value, even where the block renders a truncated preview.
 * Clicks are swallowed so hosting a button inside a <summary> or a collapsible
 * message header doesn't toggle it.
 */
export function CopyButton({
  text,
  label,
  className = "",
}: {
  text: string | (() => string);
  label: I18nKey;
  className?: string;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const title = copied ? t("message_copied") : t(label);
  return (
    <button
      type="button"
      className={["copy-btn", className, copied ? "copied" : ""].filter(Boolean).join(" ")}
      title={title}
      aria-label={title}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        navigator.clipboard?.writeText(typeof text === "function" ? text() : text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <IconCheck /> : <IconCopy />}
    </button>
  );
}
