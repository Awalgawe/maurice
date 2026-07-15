import { useEffect, useState } from "react";
import { useT } from "../../hooks/useT";
import { EditorSelect } from "./EditorSelect";
import { LangSelect } from "./LangSelect";
import { ThemeSelect } from "./ThemeSelect";

const IconSliders = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 4h6M11 4h3" />
    <circle cx="8.5" cy="4" r="1.4" />
    <path d="M2 8h2M7 8h7" />
    <circle cx="4.5" cy="8" r="1.4" />
    <path d="M2 12h4M9.5 12h4.5" />
    <circle cx="6.5" cy="12" r="1.4" />
  </svg>
);

/** Topbar gear icon that opens an overlay with the theme/language/editor selectors. */
export function ConfigOverlay() {
  const t = useT();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="config-trigger"
        aria-label={t("config_open")}
        title={t("config_open")}
        onClick={() => setOpen(true)}
      >
        <IconSliders />
      </button>
      {open && (
        <div className="config-backdrop" onClick={() => setOpen(false)}>
          <div className="config-panel" role="dialog" aria-modal="true" aria-label={t("config_title")} onClick={(e) => e.stopPropagation()}>
            <div className="config-panel-head">
              <h3>{t("config_title")}</h3>
              <button type="button" className="config-close" aria-label={t("config_close")} onClick={() => setOpen(false)}>×</button>
            </div>

            <div className="config-row">
              <span>{t("config_theme")}</span>
              <ThemeSelect />
            </div>
            <div className="config-row">
              <span>{t("config_lang")}</span>
              <LangSelect />
            </div>
            <div className="config-row">
              <span>{t("config_editor")}</span>
              <EditorSelect />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
