/**
 * Auto-scroll state machine for the messages scroller.
 *
 * Pins the scroller to the bottom while the user is near it, releases the
 * magnet when they deliberately scroll up, and grants a short "touch grace"
 * after touchend so swipe inertia isn't yanked back by the next streamed
 * word. The touch-grace rules were tuned against real iOS behaviour — do
 * not simplify them away.
 */

/** Desktop: distance (px) from bottom that still counts as "at the bottom". */
const DESKTOP_THRESHOLD = 100
/** Mobile: clamp(RATIO * visible scroller height). */
const MOBILE_THRESHOLD_RATIO = 0.25
const MOBILE_THRESHOLD_MIN = 48
const MOBILE_THRESHOLD_MAX = 120
/** After touchend away from the bottom, suppress auto-scroll for this long. */
const TOUCH_GRACE_MS = 800

const isMobile = () => window.matchMedia('(max-width: 768px)').matches

export function scrollToBottom(scroller: HTMLElement): void {
  scroller.scrollTop = scroller.scrollHeight
}

export function distanceFromBottom(scroller: HTMLElement): number {
  return Math.max(0, scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight)
}

export interface AutoScrollTracker {
  /** Per-frame check: should the renderer re-pin to bottom right now? */
  shouldStickToBottom(): boolean
  /** Did the user actively scroll away? (ignores touch grace — for end-of-stream) */
  isUserScrolledAway(): boolean
  /** Remove listeners. */
  detach(): void
}

export function attachAutoScrollTracker(scroller: HTMLElement): AutoScrollTracker {
  let userScrolledAway = false
  let touchGraceUntil = 0

  const threshold = () => {
    if (!isMobile()) return DESKTOP_THRESHOLD
    return Math.min(
      MOBILE_THRESHOLD_MAX,
      Math.max(MOBILE_THRESHOLD_MIN, Math.floor(scroller.clientHeight * MOBILE_THRESHOLD_RATIO))
    )
  }

  const onScroll = () => {
    const distance = distanceFromBottom(scroller)
    if (distance > threshold() * 2) userScrolledAway = true
    else if (distance <= threshold()) userScrolledAway = false
  }

  // Only pause the magnet if the touch happens while already scrolled away:
  // a tap at the bottom (chip, link, copy button) must not kill auto-scroll
  // for the full grace period.
  const onTouchStart = () => {
    if (distanceFromBottom(scroller) > threshold()) {
      touchGraceUntil = Number.POSITIVE_INFINITY
    }
  }

  const onTouchEnd = () => {
    touchGraceUntil = distanceFromBottom(scroller) > threshold()
      ? performance.now() + TOUCH_GRACE_MS
      : 0
  }

  scroller.addEventListener('scroll', onScroll, { passive: true })
  scroller.addEventListener('touchstart', onTouchStart, { passive: true })
  scroller.addEventListener('touchend', onTouchEnd, { passive: true })
  scroller.addEventListener('touchcancel', onTouchEnd, { passive: true })

  return {
    shouldStickToBottom() {
      if (userScrolledAway) return false
      if (performance.now() < touchGraceUntil) return false
      return distanceFromBottom(scroller) <= threshold()
    },
    isUserScrolledAway: () => userScrolledAway,
    detach() {
      scroller.removeEventListener('scroll', onScroll)
      scroller.removeEventListener('touchstart', onTouchStart)
      scroller.removeEventListener('touchend', onTouchEnd)
      scroller.removeEventListener('touchcancel', onTouchEnd)
    },
  }
}
