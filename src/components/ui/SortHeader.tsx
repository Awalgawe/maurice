import type { SortDir } from "../../hooks/useSortable";

/**
 * Clickable sortable <th>. Shows ▲/▼ when its key is active, otherwise `idle`
 * (Sessions passes "" — nothing; Workflow passes " ↕"). `th` is already
 * cursor:pointer in the global stylesheet.
 */
export function SortHeader<K extends string>({
  k, label, active, dir, onSort, className, idle = "",
}: {
  k: K;
  label: string;
  active: K;
  dir: SortDir;
  onSort: (k: K) => void;
  className?: string;
  idle?: string;
}) {
  const glyph = k === active ? (dir === 1 ? " ▲" : " ▼") : idle;
  return (
    <th className={className} onClick={() => onSort(k)}>
      {label}{glyph}
    </th>
  );
}
