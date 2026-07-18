import { useT } from "../../hooks/useT";

/** Centered error message + retry button, shared by the pages that load the
 *  session index. Keeps a failed fetch visibly distinct from an empty result. */
export function ErrorState({ message, onRetry }: { message?: string | null; onRetry: () => void }) {
  const t = useT();
  return (
    <div className="center async-error">
      <p style={{ color: "var(--red)" }}>{message || t("async_error")}</p>
      <button type="button" className="retry-btn" onClick={onRetry}>
        {t("async_retry")}
      </button>
    </div>
  );
}
