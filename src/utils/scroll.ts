/** Tolerance (px) for treating a scroll position as "at the edge". */
export const SCROLL_EPSILON_PX = 10;
/** Cooldown (ms) between wheel-driven page turns at a scroll boundary. */
export const WHEEL_THROTTLE_MS = 700;
/** Fraction of the viewport height scrolled per PageUp/PageDown. */
export const PAGE_SCROLL_FRACTION = 0.9;

export function isAtBottom(el: HTMLElement): boolean {
  return el.scrollTop + el.clientHeight >= el.scrollHeight - SCROLL_EPSILON_PX;
}

export function isAtTop(el: HTMLElement): boolean {
  return el.scrollTop <= SCROLL_EPSILON_PX;
}
