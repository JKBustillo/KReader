import { useCallback, useEffect, useRef } from "react";
import {
  HELD_PAGE_SCROLL_SCREENS_PER_SEC,
  MAX_HELD_SCROLL_FRAME_MS,
  MAX_QUEUED_PAGE_SCROLLS,
  PAGE_SCROLL_FRACTION,
} from "../utils/scroll";

type HeldScroll = { el: HTMLElement; direction: 1 | -1; top: number; last: number; frame: number };

/**
 * PageUp/PageDown scrolling for Reader and PDFReader. A smooth scroll restarts
 * slowly every time it is retargeted, so:
 * - separate presses chain from where the running smooth scroll is headed;
 * - a held key (key repeat) switches to a constant-speed scroll until keyup.
 */
export function usePageScroll() {
  // Keyed by element: PDFReader swaps its scroll container when toggling cascade.
  const targetRef = useRef<{ el: HTMLElement; top: number } | null>(null);
  const heldRef = useRef<HeldScroll | null>(null);

  const stopHeld = useCallback(() => {
    if (heldRef.current) cancelAnimationFrame(heldRef.current.frame);
    heldRef.current = null;
  }, []);

  useEffect(() => {
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "PageDown" || e.key === "PageUp") stopHeld();
    };
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", stopHeld);
    return () => {
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", stopHeld);
      stopHeld();
    };
  }, [stopHeld]);

  const startHeld = useCallback((el: HTMLElement, direction: 1 | -1) => {
    const running = heldRef.current;
    if (running?.el === el && running.direction === direction) return;
    stopHeld();
    targetRef.current = null;

    const tick = (now: number) => {
      const held = heldRef.current;
      if (!held) return;
      const dt = Math.min(now - held.last, MAX_HELD_SCROLL_FRAME_MS) / 1000;
      held.last = now;
      const maxTop = el.scrollHeight - el.clientHeight;
      // Tracked as a float: per-frame steps would be lost to scrollTop rounding.
      held.top = Math.min(Math.max(held.top + direction * el.clientHeight * HELD_PAGE_SCROLL_SCREENS_PER_SEC * dt, 0), maxTop);
      // "instant" overrides the container's CSS scroll-behavior: smooth.
      el.scrollTo({ top: held.top, behavior: "instant" });
      held.frame = requestAnimationFrame(tick);
    };
    heldRef.current = { el, direction, top: el.scrollTop, last: performance.now(), frame: requestAnimationFrame(tick) };
  }, [stopHeld]);

  const stepScroll = useCallback((el: HTMLElement, direction: 1 | -1) => {
    stopHeld();
    const step = el.clientHeight * PAGE_SCROLL_FRACTION;
    const maxTop = el.scrollHeight - el.clientHeight;
    const pending = targetRef.current?.el === el ? targetRef.current.top : null;
    let top = Math.min(Math.max((pending ?? el.scrollTop) + direction * step, 0), maxTop);
    // Capped lead so fast presses don't keep scrolling for several screens afterwards.
    const lead = MAX_QUEUED_PAGE_SCROLLS * step;
    top = direction > 0 ? Math.min(top, el.scrollTop + lead) : Math.max(top, el.scrollTop - lead);

    // No movement means no scrollend to clear the target, so don't record one.
    if (Math.abs(top - el.scrollTop) < 1) {
      targetRef.current = null;
      return;
    }
    if (pending === null) {
      el.addEventListener("scrollend", () => { targetRef.current = null; }, { once: true });
    }
    targetRef.current = { el, top };
    el.scrollTo({ top, behavior: "smooth" });
  }, [stopHeld]);

  return useCallback((el: HTMLElement, direction: 1 | -1, held: boolean) => {
    if (held) startHeld(el, direction);
    else stepScroll(el, direction);
  }, [startHeld, stepScroll]);
}
