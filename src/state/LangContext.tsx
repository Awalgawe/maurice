import React, { createContext, useContext, useState } from "react";
import { type Lang, SUPPORTED_LANGS, DEFAULT_LANG } from "../i18n/index";

export type { Lang };

const STORAGE_KEY = "claude-sessions:lang";

function detectBrowserLang(): Lang {
  const browserLang = navigator.language.split("-")[0] as Lang;
  return SUPPORTED_LANGS.includes(browserLang) ? browserLang : DEFAULT_LANG;
}

interface LangContextValue {
  lang: Lang;
  langPref: Lang | null;
  setLang: (l: Lang | null) => void;
}

const LangContext = createContext<LangContextValue>({
  lang: DEFAULT_LANG,
  langPref: null,
  setLang: () => {},
});

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [langPref, setLangPref] = useState<Lang | null>(
    () => localStorage.getItem(STORAGE_KEY) as Lang | null
  );

  const lang = langPref ?? detectBrowserLang();

  function setLang(l: Lang | null) {
    if (l === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, l);
    setLangPref(l);
  }

  return (
    <LangContext.Provider value={{ lang, langPref, setLang }}>
      {children}
    </LangContext.Provider>
  );
}

export function useLang() {
  return useContext(LangContext);
}
