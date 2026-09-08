import { createContext, useContext } from "react";
import type { PeerEventView } from "../../types";

/**
 * Resolved peer views of the session being read, keyed by eventId.
 *
 * A context, not a prop: `Message` is the thread's `React.memo` perf boundary
 * and `Block` only ever receives its own block, so neither can be handed a map
 * without breaking what makes them cheap. The two peer renderers hold an
 * eventId and read the map at their own leaf.
 *
 * Empty by default — a subagent thread has no peer resolution, and asking for a
 * missing key simply yields no decoration.
 */
export const PeerEventsContext = createContext<Record<string, PeerEventView>>({});

/** The resolved view of one event, or null when there is none (unknown key,
 *  subagent thread, or an event the graph could not place). */
export function usePeerEvent(eventId: string | null | undefined): PeerEventView | null {
  const views = useContext(PeerEventsContext);
  if (!eventId) return null;
  return views[eventId] ?? null;
}
