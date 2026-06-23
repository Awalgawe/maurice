import { useT } from "../../hooks/useT";

/** Prev / "p / pages (total)" / Next. 1-indexed. Hidden when single page. */
export function Pager({
  page, pages, total, onPage,
}: {
  page: number; pages: number; total: number; onPage: (p: number) => void;
}) {
  const t = useT();
  if (pages <= 1) return null;
  return (
    <div className="pager">
      {pages > 2 && <button disabled={page <= 1} onClick={() => onPage(1)}>{t("pager_first")}</button>}
      <button disabled={page <= 1} onClick={() => onPage(page - 1)}>{t("pager_prev")}</button>
      <span className="muted">{page} / {pages} ({total} {t("pager_count")})</span>
      <button disabled={page >= pages} onClick={() => onPage(page + 1)}>{t("pager_next")}</button>
      {pages > 2 && <button disabled={page >= pages} onClick={() => onPage(pages)}>{t("pager_last")}</button>}
    </div>
  );
}
