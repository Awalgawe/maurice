import { useEffect, useState } from "react";

/** Reactive matchMedia. Used where CSS alone can't respond to the viewport,
 *  e.g. conditionally rendering table columns (colgroup/th/td must stay in sync). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    mql.addEventListener("change", onChange);
    setMatches(mql.matches);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}
