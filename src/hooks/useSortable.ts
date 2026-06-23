import { useState } from "react";

export type SortDir = 1 | -1;

/**
 * Sort state shared by the Sessions and Workflow tables: a key, a direction,
 * a toggle (same key flips direction, new key resets to descending), and a
 * pure `sortBy` that sorts a copy by a caller-provided accessor.
 * Render-pure: callers still wrap `sortBy` in their own useMemo.
 */
export function useSortable<K extends string>(initialKey: K, initialDir: SortDir = -1) {
  const [sortKey, setSortKey] = useState<K>(initialKey);
  const [sortDir, setSortDir] = useState<SortDir>(initialDir);

  function toggle(k: K) {
    if (k === sortKey) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(k);
      setSortDir(-1);
    }
  }

  function sortBy<T>(rows: T[], val: (row: T) => number | string): T[] {
    return [...rows].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      const cmp =
        typeof va === "number" && typeof vb === "number"
          ? va - vb
          : String(va).localeCompare(String(vb));
      return cmp * sortDir;
    });
  }

  return { sortKey, sortDir, toggle, sortBy };
}
