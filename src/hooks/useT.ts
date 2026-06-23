import { useCallback } from "react";
import { useLang } from "../state/LangContext";
import { translations, type I18nKey } from "../i18n/index";

export type { I18nKey };

export function useT() {
  const { lang } = useLang();
  const dict = translations[lang];
  return useCallback((key: I18nKey) => dict[key], [dict]);
}
