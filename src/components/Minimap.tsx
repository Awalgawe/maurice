import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MessageKind, ThreadMessage } from "../types";
import { useT } from "../hooks/useT";

type Strip = { topPct: number; kind: MessageKind; isError: boolean; index: number };

/**
 * A miniature of the whole thread shown as one thin colored line per message
 * header, positioned proportionally to the real header positions, plus a
 * translucent box tracking the visible viewport. Click a line (or the rail) to
 * jump. Positions are read straight from the live DOM, so they stay accurate as
 * messages collapse/expand and as content-visibility refines off-screen heights.
 */
export function Minimap({
  messages,
  threadRef,
}: {
  messages: ThreadMessage[];
  threadRef: React.RefObject<HTMLElement | null>;
}) {
  const t = useT();
  const [strips, setStrips] = useState<Strip[]>([]);
  const [view, setView] = useState<{ topPct: number; heightPct: number }>({ topPct: 0, heightPct: 0 });
  const railRef = useRef<HTMLDivElement>(null);

  const measureView = useCallback(() => {
    const thread = threadRef.current;
    if (!thread) return;
    const rect = thread.getBoundingClientRect();
    const h = thread.offsetHeight || 1;
    const top = Math.max(0, -rect.top);
    const bottom = Math.min(h, -rect.top + window.innerHeight);
    setView({ topPct: (top / h) * 100, heightPct: (Math.max(0, bottom - top) / h) * 100 });
  }, [threadRef]);

  const measureStrips = useCallback(() => {
    const thread = threadRef.current;
    if (!thread) return;
    const els = thread.querySelectorAll<HTMLElement>(".msg");
    const threadTop = thread.getBoundingClientRect().top + window.scrollY;
    const h = thread.offsetHeight || 1;
    const next: Strip[] = [];
    els.forEach((el, i) => {
      const msg = messages[i];
      if (!msg) return;
      const top = el.getBoundingClientRect().top + window.scrollY - threadTop;
      next.push({
        topPct: (top / h) * 100,
        kind: msg.kind,
        isError: msg.isError ?? false,
        index: i,
      });
    });
    setStrips(next);
    measureView();
  }, [messages, threadRef, measureView]);

  // content-visibility:auto makes off-screen messages report the placeholder
  // height (contain-intrinsic-size), so the thread height — and every strip's %
  // position — keeps shifting during the first scroll-through. Force one real
  // layout, then seed each message's measured height as its own placeholder so
  // off-screen estimates match reality: the minimap stays put and cv still skips
  // off-screen paint. Re-runs per page (messages change).
  useLayoutEffect(() => {
    const thread = threadRef.current;
    if (!thread) return;
    const msgs = thread.querySelectorAll<HTMLElement>(".msg");
    msgs.forEach((m) => (m.style.contentVisibility = "visible"));
    void thread.offsetHeight; // force synchronous reflow at real sizes
    const heights: number[] = [];
    msgs.forEach((m) => heights.push(m.clientHeight));
    msgs.forEach((m, i) => {
      m.style.contentVisibility = "";
      m.style.containIntrinsicSize = `auto ${heights[i]}px`;
    });
  }, [messages, threadRef]);

  // Remeasure positions on layout changes (collapse toggles, cv:auto height
  // refinement both resize the thread box, which the ResizeObserver catches).
  useLayoutEffect(() => {
    const thread = threadRef.current;
    if (!thread) return;
    let raf = 0;
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measureStrips);
    };
    schedule();
    const ro = new ResizeObserver(schedule);
    ro.observe(thread);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [measureStrips, threadRef]);

  // Cheap viewport-box update on scroll/resize (no per-message reads).
  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measureView);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [measureView]);

  const jumpToMessage = (index: number) => {
    const el = threadRef.current?.querySelectorAll<HTMLElement>(".msg")[index];
    if (!el) return;
    // 56 = topbar (48) + small gap, so the message clears the sticky topbar.
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 56, behavior: "smooth" });
  };

  const jumpToRail = (e: React.MouseEvent<HTMLDivElement>) => {
    const thread = threadRef.current;
    if (!thread) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientY - rect.top) / rect.height;
    const threadTop = thread.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({
      top: threadTop + pct * thread.offsetHeight - window.innerHeight / 2,
      behavior: "smooth",
    });
  };

  return (
    <div className="minimap" aria-label={t("minimap_aria")}>
      <div ref={railRef} className="mm-rail" onClick={jumpToRail}>
        <div className="mm-view" style={{ top: `${view.topPct}%`, height: `${view.heightPct}%` }} aria-hidden="true" />
        {strips.map((s) => (
          <button
            key={s.index}
            type="button"
            className={`mm-strip kind-${s.kind}${s.isError ? " is-error" : ""}`}
            style={{ top: `${s.topPct}%` }}
            title={t(`message_kind_${s.kind}`)}
            aria-label={t(`message_kind_${s.kind}`)}
            onClick={(e) => {
              e.stopPropagation();
              jumpToMessage(s.index);
            }}
          />
        ))}
      </div>
    </div>
  );
}
