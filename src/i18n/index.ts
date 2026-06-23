import { fr } from "./fr";
import { en } from "./en";
import type { I18nKey } from "./fr";

export type { I18nKey };

export const translations = { fr, en } as const;

export type Lang = keyof typeof translations;

export const SUPPORTED_LANGS = Object.keys(translations) as Lang[];

export const DEFAULT_LANG: Lang = "en";
