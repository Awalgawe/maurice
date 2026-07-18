import { useCallback, useEffect, useState } from "react";
import type { SessionMeta } from "../types";
import { getSessions } from "../api";

export type AsyncStatus = "loading" | "success" | "error";

/**
 * Shared loader for the full session index (Dashboard, Sessions, Workflow,
 * Timeline, Hooks all need it). Distinguishes the three states so a failed fetch
 * is never rendered as "no sessions": on error, `status` is "error" (not an
 * empty list), and an empty install surfaces as success-with-zero-rows, not a
 * perpetual spinner. A stale in-flight response is discarded (the `live` guard),
 * so a slow reload can't overwrite a newer result.
 */
export function useSessions(refetchOnFocus = false): {
  sessions: SessionMeta[];
  status: AsyncStatus;
  error: string | null;
  reload: () => void;
} {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [status, setStatus] = useState<AsyncStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    getSessions()
      .then((s) => {
        if (!live) return;
        setSessions(s);
        setError(null);
        setStatus("success");
      })
      .catch((e) => {
        if (!live) return;
        setError(String(e));
        setStatus("error");
      });
    return () => {
      live = false;
    };
  }, [nonce]);

  useEffect(() => {
    if (!refetchOnFocus) return;
    window.addEventListener("focus", reload);
    return () => window.removeEventListener("focus", reload);
  }, [refetchOnFocus, reload]);

  return { sessions, status, error, reload };
}
