import { useCallback } from "react";
import { useLang } from "../state/LangContext";
import { translations, DEFAULT_LANG, type I18nKey } from "../i18n/index";

export type { I18nKey };

export function useT() {
  const { lang } = useLang();
  // Defensive fallback: never index into an undefined dictionary if `lang`
  // somehow isn't a supported code (see LangContext validation).
  const dict = translations[lang] ?? translations[DEFAULT_LANG];
  return useCallback((key: I18nKey) => dict[key], [dict]);
}
