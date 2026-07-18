import { useCallback } from "react";
import { useLang } from "../state/LangContext";
import { translations, DEFAULT_LANG, type I18nKey } from "../i18n/index";

export type { I18nKey };

export type TFunc = (key: I18nKey, params?: Record<string, string | number>) => string;

export function useT(): TFunc {
  const { lang } = useLang();
  // Defensive fallback: never index into an undefined dictionary if `lang`
  // somehow isn't a supported code (see LangContext validation).
  const dict = translations[lang] ?? translations[DEFAULT_LANG];
  return useCallback((key: I18nKey, params?: Record<string, string | number>) => {
    const raw = dict[key];
    // Interpolate {name} placeholders only when params are supplied — existing
    // callers pass none and get the string verbatim.
    return params ? raw.replace(/\{(\w+)\}/g, (_, k) => (k in params ? String(params[k]) : `{${k}}`)) : raw;
  }, [dict]);
}
