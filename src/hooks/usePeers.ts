import { useEffect, useState } from "react";
import type { PeerGraph } from "../types";
import { getPeers } from "../api";
import type { AsyncStatus } from "./useSessions";

/**
 * Shared loader for the cross-session graph — sibling of `useSessions`, and the
 * declared source of every peer badge (Sessions list, Timeline connectors).
 * `/api/sessions` is deliberately left alone: the join is derived from the whole
 * index plus the live registry, so it does not belong in a per-session payload.
 *
 * A failure yields an empty graph and status "error": a badge that cannot be
 * computed is simply not shown, never shown as zero traffic.
 */
export function usePeers(): { graph: PeerGraph | null; status: AsyncStatus; error: string | null } {
  const [graph, setGraph] = useState<PeerGraph | null>(null);
  const [status, setStatus] = useState<AsyncStatus>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getPeers()
      .then((g) => {
        if (!live) return;
        setGraph(g);
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
  }, []);

  return { graph, status, error };
}
