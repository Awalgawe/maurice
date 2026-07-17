import React, { useState } from "react";
import type { ThreadMessage } from "../../types";
import { fmtCost, fmtTokens, skillLabel } from "../../format";
import { useT } from "../../hooks/useT";
import { messageToText } from "../../lib/messageText";
import { Chip } from "../ui/Chip";
import { Block } from "./Block";

const IconCopy = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="5" y="5" width="9" height="9" rx="1.5" />
    <path d="M11 5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2" />
  </svg>
);

const IconCheck = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 8.5l3.5 3.5L13 5" />
  </svg>
);

const IconChevron = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 4l4 4-4 4" />
  </svg>
);

/**
 * One conversation turn. React.memo is THE perf boundary: it stops the whole
 * 200-message thread from re-rendering when a parent's state changes.
 */
export const Message = React.memo(function Message({ m, compact = false }: { m: ThreadMessage; compact?: boolean }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [uuidCopied, setUuidCopied] = useState(false);
  // Every turn can be collapsed; meta turns (system reminders, skill injections…)
  // are noise by default, so they start collapsed.
  const [collapsed, setCollapsed] = useState(m.kind === "meta");
  const cls = [
    "msg",
    m.kind === "assistant" ? "assistant" : "user",
    `kind-${m.kind}`,
    m.isSidechain ? "sidechain" : "",
    m.fork !== null ? "fork" : "",
    m.isError ? "haserror" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cls} id={m.uuid ? `msg-${m.uuid}` : undefined}>
      <div
        className="head collapsible"
        role="button"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((c) => !c)}
      >
        <span className={"collapse-toggle" + (collapsed ? "" : " open")} aria-hidden="true">
          <IconChevron />
        </span>
        <span className="role">{t(`message_kind_${m.kind}`)}</span>
        {m.model && <Chip>{m.model.replace(/^claude-/, "")}</Chip>}
        {m.skill && <Chip variant="skill">{skillLabel(m.skill)}</Chip>}
        {m.tokens && (
          <Chip>
            ↑{fmtTokens(m.tokens.input + m.tokens.cacheRead + m.tokens.cacheCreate)} ↓
            {fmtTokens(m.tokens.output)}
          </Chip>
        )}
        {m.cacheRewrite && (
          <Chip
            variant="warn"
            title={
              `${fmtTokens(m.cacheRewrite.rewrittenTokens)} ${t("message_cache_rewrite_tokens")} · ` +
              (m.cacheRewrite.cause === "idle"
                ? `${t("message_cache_rewrite_idle")}${m.cacheRewrite.gapMs !== null ? ` (${Math.round(m.cacheRewrite.gapMs / 60000)} min)` : ""}`
                : m.cacheRewrite.cause === "tools-changed"
                  ? t("message_cache_rewrite_tools")
                  : t("message_cache_rewrite_edit"))
            }
          >
            ⚠ {t("message_cache_rewrite_chip")} ≈{fmtCost(m.cacheRewrite.wastedUSD)}
          </Chip>
        )}
        {m.isError && <Chip variant="err">{t("message_error_chip")}</Chip>}
        {m.isSidechain && <Chip>{t("message_sidechain")}</Chip>}
        {m.fork !== null && <Chip>{t("message_fork_chip")}</Chip>}
        <span className="head-actions">
          {m.uuid && (
            <button
              type="button"
              className={"msg-uuid" + (uuidCopied ? " copied" : "")}
              title={uuidCopied ? t("message_copied") : `${m.uuid} · ${t("message_copy_uuid")}`}
              aria-label={t("message_copy_uuid")}
              onClick={(e) => {
                e.stopPropagation();
                navigator.clipboard?.writeText(m.uuid!);
                setUuidCopied(true);
                setTimeout(() => setUuidCopied(false), 2000);
              }}
            >
              {m.uuid.slice(0, 8)}
            </button>
          )}
          <button
            type="button"
            className={"msg-copy" + (copied ? " copied" : "")}
            title={copied ? t("message_copied") : t("message_copy")}
            aria-label={copied ? t("message_copied") : t("message_copy")}
            onClick={(e) => {
              e.stopPropagation();
              navigator.clipboard?.writeText(messageToText(m));
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? <IconCheck /> : <IconCopy />}
          </button>
        </span>
      </div>
      {!collapsed && (
        <div className="body">
          {m.blocks.map((b, i) => (
            <Block key={i} b={b} compact={compact} />
          ))}
          {m.blocks.length === 0 && <span className="muted">—</span>}
        </div>
      )}
    </div>
  );
});
