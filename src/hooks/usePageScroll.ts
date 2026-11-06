import { useCallback, useEffect, useRef } from "react";
import {
  HELD_PAGE_SCROLL_SCREENS_PER_SEC,
  MAX_QUEUED_PAGE_SCROLLS,
  MAX_SCROLL_FRAME_MS,
  PAGE_SCROLL_FRACTION,
  PAGE_SCROLL_SETTLE_PX,
  PAGE_SCROLL_SETTLE_SPEED,
  PAGE_SCROLL_SPRING_RATE,
} from "../utils/scroll";

type PageScroll = {
  el: HTMLElement;
  target: number;
  // Tracked as a float: per-frame steps would be lost to scrollTop rounding.
  top: number;
  velocity: number;
  heldDirection: 1 | -1 | null;
  // What scrollTop read back after our last write, to notice anything else moving it.
  written: number;
  last: number;
  frame: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/**
 * PageUp/PageDown scrolling for Reader and PDFReader. A native smooth scroll restarts
 * from zero speed every time it is retargeted, so one spring-driven loop per container
 * follows a target instead: presses move the target, a held key (key repeat) moves it
 * at constant speed until keyup, and the velocity carries across both.
 */
export function usePageScroll() {
  const scrollRef = useRef<PageScroll | null>(null);

  const stopPageScroll = useCallback(() => {
    if (scrollRef.current) cancelAnimationFrame(scrollRef.current.frame);
    scrollRef.current = null;
  }, []);

  useEffect(() => {
    const releaseHeld = () => {
      if (scrollRef.current) scrollRef.current.heldDirection = null;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "PageDown" || e.key === "PageUp") releaseHeld();
    };
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", releaseHeld);
    return () => {
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", releaseHeld);
      stopPageScroll();
    };
  }, [stopPageScroll]);

  // PDFReader swaps its scroll container when toggling cascade, hence the check on el.
  const scrollFor = useCallback((el: HTMLElement): PageScroll => {
    const running = scrollRef.current;
    if (running?.el === el) return running;
    stopPageScroll();

    const tick = (now: number) => {
      const scroll = scrollRef.current;
      if (!scroll) return;
      // Wheel, page turns and zoom take over: fighting them would snap the view back.
      if (el.scrollTop !== scroll.written) {
        stopPageScroll();
        return;
      }
      // rAF's timestamp is the frame start, so the first one can predate scroll.last.
      const dt = clamp(now - scroll.last, 0, MAX_SCROLL_FRAME_MS) / 1000;
      scroll.last = now;
      const maxTop = el.scrollHeight - el.clientHeight;
      if (scroll.heldDirection) {
        scroll.target += scroll.heldDirection * el.clientHeight * HELD_PAGE_SCROLL_SCREENS_PER_SEC * dt;
      }
      scroll.target = clamp(scroll.target, 0, maxTop);

      // Closed form of a critically damped spring: stable at any dt, never oscillates.
      const offset = scroll.top - scroll.target;
      const decay = Math.exp(-PAGE_SCROLL_SPRING_RATE * dt);
      const impulse = (scroll.velocity + PAGE_SCROLL_SPRING_RATE * offset) * dt;
      const nextOffset = (offset + impulse) * decay;
      scroll.velocity = (scroll.velocity - impulse * PAGE_SCROLL_SPRING_RATE) * decay;
      scroll.top = clamp(scroll.target + nextOffset, 0, maxTop);

      const settled = !scroll.heldDirection
        && Math.abs(nextOffset) < PAGE_SCROLL_SETTLE_PX
        && Math.abs(scroll.velocity) < PAGE_SCROLL_SETTLE_SPEED;
      // "instant" overrides the container's CSS scroll-behavior: smooth.
      el.scrollTo({ top: settled ? scroll.target : scroll.top, behavior: "instant" });
      scroll.written = el.scrollTop;
      if (settled) scrollRef.current = null;
      else scroll.frame = requestAnimationFrame(tick);
    };

    const created: PageScroll = {
      el,
      target: el.scrollTop,
      top: el.scrollTop,
      velocity: 0,
      heldDirection: null,
      written: el.scrollTop,
      last: performance.now(),
      frame: requestAnimationFrame(tick),
    };
    scrollRef.current = created;
    return created;
  }, [stopPageScroll]);

  return useCallback((el: HTMLElement, direction: 1 | -1, held: boolean) => {
    const scroll = scrollFor(el);
    if (held) {
      scroll.heldDirection = direction;
      return;
    }
    scroll.heldDirection = null;
    const step = el.clientHeight * PAGE_SCROLL_FRACTION;
    // Capped lead so fast presses don't keep scrolling for several screens afterwards.
    const lead = MAX_QUEUED_PAGE_SCROLLS * step;
    const next = scroll.target + direction * step;
    scroll.target = direction > 0 ? Math.min(next, el.scrollTop + lead) : Math.max(next, el.scrollTop - lead);
  }, [scrollFor]);
}
