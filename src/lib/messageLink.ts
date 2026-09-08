/** Messages served per page by the session detail. The single definition: the
 *  page a deep link lands on is computed from it, so a change here can never
 *  desynchronize the link from the view. */
export const DETAIL_PAGE = 200;

/** Enough to place a message inside a session: which view owns it, where it
 *  sits in that view, and its anchor. */
export interface MessageAnchor {
  uuid: string | null;
  index: number;
  branch?: string | null;
  fork?: string | null;
}

/**
 * Deep link to one message: right view (?branch), right page, anchor.
 *
 * Returns **null** when the target has no uuid — such a turn has no anchor to
 * scroll to, and a link that lands on the right page but the wrong message is
 * worse than no link at all.
 */
export function messageLink(sessionId: string, at: MessageAnchor): string | null {
  if (!at.uuid) return null;
  const qs = new URLSearchParams();
  const page = Math.floor(at.index / DETAIL_PAGE) + 1;
  if (page > 1) qs.set("page", String(page));
  const branch = at.branch ?? at.fork ?? null;
  if (branch) qs.set("branch", branch);
  const q = qs.toString();
  return `/sessions/${sessionId}${q ? `?${q}` : ""}#msg-${at.uuid}`;
}
