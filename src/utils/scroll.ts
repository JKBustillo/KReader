/** Tolerance (px) for treating a scroll position as "at the edge". */
export const SCROLL_EPSILON_PX = 10;
/** Cooldown (ms) between wheel-driven page turns at a scroll boundary. */
export const WHEEL_THROTTLE_MS = 700;
/** Fraction of the viewport height scrolled per PageUp/PageDown. */
export const PAGE_SCROLL_FRACTION = 0.9;
/** How many PageUp/PageDown steps fast presses may queue ahead of the visible position. */
export const MAX_QUEUED_PAGE_SCROLLS = 2;
/** Scroll speed, in viewport heights per second, while PageUp/PageDown is held. */
export const HELD_PAGE_SCROLL_SCREENS_PER_SEC = 5;
/** Longest frame step (ms) the held scroll accepts, so a stalled frame doesn't jump. */
export const MAX_HELD_SCROLL_FRAME_MS = 50;

export function isAtBottom(el: HTMLElement): boolean {
  return el.scrollTop + el.clientHeight >= el.scrollHeight - SCROLL_EPSILON_PX;
}

export function isAtTop(el: HTMLElement): boolean {
  return el.scrollTop <= SCROLL_EPSILON_PX;
}
