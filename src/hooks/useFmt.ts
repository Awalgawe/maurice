import { useMemo } from "react";
import { useLang } from "../state/LangContext";
import { fmtDate, fmtDay, fmtDayLong, fmtTokens, fmtCost, fmtAgo } from "../format";

export function useFmt() {
  const { lang } = useLang();
  return useMemo(() => ({
    fmtDate:    (iso: string | null) => fmtDate(iso, lang),
    fmtAgo:     (iso: string | null) => fmtAgo(iso, lang),
    fmtDay:     (ymd: string)        => fmtDay(ymd, lang),
    fmtDayLong: (ymd: string)        => fmtDayLong(ymd, lang),
    fmtTokens:  (n: number)          => fmtTokens(n, lang),
    fmtCost:    (n: number)          => fmtCost(n, lang),
  }), [lang]);
}
