import { Link } from "react-router-dom";
import type { PeerEventView, PeerInbound } from "../../types";
import { useFmt } from "../../hooks/useFmt";
import { useT } from "../../hooks/useT";
import { usePeerEvent } from "./peerContext";

/** Live-state dot. The status is a closed union, so the key always exists. */
function LiveDot({ view }: { view: PeerEventView }) {
  const t = useT();
  return (
    <span
      className={`peer-dot live-${view.liveStatus}`}
      title={t(`peer_live_${view.liveStatus}`)}
      aria-label={t(`peer_live_${view.liveStatus}`)}
    />
  );
}

/** The counterpart link, or the reason there is none — never a link that would
 *  land somewhere plausible but wrong. */
function Counterpart({ view }: { view: PeerEventView }) {
  const t = useT();
  if (view.counterpartLink) {
    return (
      <Link to={view.counterpartLink} className="peer-link" onClick={(e) => e.stopPropagation()}>
        {t("peer_open_counterpart")}
      </Link>
    );
  }
  if (view.unresolved) return <span className="muted">{t(`peer_unresolved_${view.unresolved.reason}`)}</span>;
  return null;
}

/**
 * Header decoration of a received turn: who it came from, their live state, and
 * the way back to the sending turn.
 *
 * Mounted by `Message`, not by `Block`: a received turn is not a tool_use, and
 * `Block`'s signature is `{ b, compact }` — it never sees the turn. This
 * component is the leaf that holds the eventId and reads the context.
 */
export function PeerInboundMeta({ peerIn }: { peerIn: PeerInbound & { eventId: string } }) {
  const t = useT();
  const view = usePeerEvent(peerIn.eventId);
  const label = view?.peerLabel ?? peerIn.peerNameHint;
  return (
    <span className="peer-meta">
      <span className="peer-arrow" aria-hidden="true">←</span>
      <span>{t("peer_from")}</span>
      {label && <span className="peer-name">{label}</span>}
      {view && <LiveDot view={view} />}
      {view && <Counterpart view={view} />}
      {!peerIn.parseComplete && <span className="muted">· {t("peer_partial_envelope")}</span>}
    </span>
  );
}

/** The protocol envelope of a received turn, collapsed. The body itself is
 *  rendered as the turn's ordinary text block. */
export function PeerEnvelope({ raw }: { raw: string }) {
  const t = useT();
  return (
    <details className="peer-envelope">
      <summary>{t("peer_raw_envelope")}</summary>
      <pre>{raw}</pre>
    </details>
  );
}

/**
 * A `SendMessage` tool_use block. Reads the same resolved view as the received
 * card, by the same key — so both ends of one exchange can never disagree.
 */
export function SendMessageInput({
  input,
  peerEventId,
}: {
  input: Record<string, unknown>;
  peerEventId?: string;
}) {
  const t = useT();
  const { fmtTokens } = useFmt();
  const view = usePeerEvent(peerEventId);
  const to = typeof input.to === "string" ? input.to : null;
  const summary = typeof input.summary === "string" ? input.summary : null;
  const message = typeof input.message === "string" ? input.message : null;
  const label = view?.peerLabel ?? to;

  return (
    <div className="peer-send">
      <span className="peer-meta">
        <span className="peer-arrow" aria-hidden="true">→</span>
        <span>{t("peer_to")}</span>
        {label && <span className="peer-name">{label}</span>}
        {view && <LiveDot view={view} />}
        {view?.outcome && (
          <span className={`peer-outcome outcome-${view.outcome}`}>{t(`peer_outcome_${view.outcome}`)}</span>
        )}
        {view && <Counterpart view={view} />}
      </span>
      {summary && <div className="peer-summary">{summary}</div>}
      {message && (
        <details className="peer-envelope">
          <summary>
            {t("peer_message_body")} · {fmtTokens(message.length)} {t("peer_chars")}
          </summary>
          <pre>{message}</pre>
        </details>
      )}
      {view?.resultExcerpt && view.outcome !== "sent" && (
        <details className="peer-envelope">
          <summary>{t(`peer_outcome_${view.outcome!}`)}</summary>
          <pre>{view.resultExcerpt}</pre>
        </details>
      )}
    </div>
  );
}
