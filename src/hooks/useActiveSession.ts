import { useEffect, useState } from "react";
import type { ActiveSession } from "../types";
import { getActive } from "../api";

export function useActiveSession(): ActiveSession | null {
  const [active, setActive] = useState<ActiveSession | null>(null);
  useEffect(() => {
    let mounted = true;
    function poll() {
      getActive()
        .then((r) => { if (mounted) setActive(r.active ? (r as ActiveSession) : null); })
        .catch(() => {});
    }
    poll();
    const id = setInterval(poll, 5_000);
    return () => { mounted = false; clearInterval(id); };
  }, []);
  return active;
}

export function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
}
