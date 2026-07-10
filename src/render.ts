/**
 * Streaming Markdown renderer.
 *
 * Built on `streaming-markdown` (smd): an append-only, stateful parser that
 * never rewrites DOM it has already emitted — once a char is on screen its
 * parent chain stays stable, so formatting can't flicker as the response
 * grows. The whole tree is built via createElement/createTextNode; there is
 * no innerHTML anywhere on this path.
 *
 * Word reveal: the SSE backend lands text in uneven chunks, so we buffer it
 * and release WHOLE words per animation frame at an adaptive cadence — faster
 * when a lot is queued, easing to a gentle floor when little is. This mirrors
 * how production chat UIs smooth bursty token arrival into a steady flow.
 *
 * Hardening:
 *   <a href>  — unsafe-scheme reject, optional locale prefix on internal
 *               paths (config.linkPrefix), target=_blank + noopener for http(s).
 *   <img src> — stripped entirely: a prompt-injected backend response must
 *               not be able to fire arbitrary outbound image requests.
 */

import * as smd from 'streaming-markdown'
import { attachAutoScrollTracker, scrollToBottom } from './scroll'
import type { LinkPrefix } from './types'

/* Adaptive reveal cadence (chars per frame @ ~60fps):
 *   small backlog → MIN floor (~120 c/s): short replies are savored word-by-word;
 *   large backlog → backlog/CATCHUP_FRAMES: long answers drain fast, no fixed
 *                   typewriter speed holding the reader hostage;
 *   MAX caps a huge single dump so a visible wave remains, not a flash. */
const MIN_CHARS_PER_FRAME = 2
const MAX_CHARS_PER_FRAME = 24
const CATCHUP_FRAMES = 24

// ── URL hardening ──────────────────────────────────────────────────────────

export function isSafeUrl(url: string): boolean {
  const trimmed = url.trim().toLowerCase()
  if (trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../')) return true
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return true
  // javascript:, data:, vbscript:, everything else
  return false
}

/** `/catalog/x` → `/en/catalog/x` for i18n hosts (see LinkPrefix). */
export function applyLinkPrefix(url: string, prefix?: LinkPrefix): string {
  const trimmed = url.trim()
  if (!prefix?.add || !trimmed.startsWith('/')) return trimmed
  const skip = prefix.skip?.length ? prefix.skip : [prefix.add]
  for (const s of skip) {
    if (trimmed === s || trimmed.startsWith(s.endsWith('/') ? s : `${s}/`)) return trimmed
  }
  return `${prefix.add}${trimmed}`
}

// ── smd renderer ───────────────────────────────────────────────────────────

interface RendererData {
  /** smd parent-node stack, indexed by `index`. Slot 0 is the bubble root. */
  nodes: HTMLElement[]
  index: number
}

function makeRenderer(root: HTMLElement, linkPrefix?: LinkPrefix): smd.Renderer<RendererData> {
  return {
    data: { nodes: [root], index: 0 },
    add_token: smd.default_add_token,
    end_token: smd.default_end_token,
    add_text: (data, text) => {
      data.nodes[data.index].appendChild(document.createTextNode(text))
    },
    set_attr: (data, type, value) => {
      const el = data.nodes[data.index]
      if (type === smd.Attr.Href && el.tagName === 'A') {
        const trimmed = value.trim()
        if (!isSafeUrl(trimmed)) return // <a> stays inert, text still shows
        el.setAttribute('href', applyLinkPrefix(trimmed, linkPrefix))
        if (trimmed.toLowerCase().startsWith('http')) {
          el.setAttribute('target', '_blank')
          el.setAttribute('rel', 'noopener noreferrer')
        }
        return
      }
      if (type === smd.Attr.Src) return // no outbound beacons via ![...](...)
      smd.default_set_attr(data, type, value)
    },
  }
}

// ── One-shot render (history replay, greeting replay, error bodies) ────────

export function renderMarkdownOneShot(
  element: HTMLElement,
  text: string,
  linkPrefix?: LinkPrefix
): void {
  element.textContent = ''
  element.removeAttribute('data-streaming')
  if (!text) return
  const parser = smd.parser(makeRenderer(element, linkPrefix))
  smd.parser_write(parser, text)
  smd.parser_end(parser)
}

// ── Streaming renderer ─────────────────────────────────────────────────────

export interface StreamingRenderer {
  /** Feed the full accumulated raw text (transport onChunk semantics). */
  update(accumulatedRawText: string): void
  /** Mark the stream complete — drains the buffer, then closes the parser. */
  finish(flushImmediately?: boolean): void
  /** Resolves when the renderer has finished (or aborted) and cleaned up. */
  done: Promise<void>
}

export interface StreamingRendererOptions {
  /** Multiplier on the reveal cadence. 1 = default, 0.5 = half speed
   *  (used for the greeting so it lands with a beat). */
  speedFactor?: number
  /** Abort → dump the remaining buffer at once and close. */
  signal?: AbortSignal
  linkPrefix?: LinkPrefix
}

export function createStreamingRenderer(
  element: HTMLElement,
  scroller: HTMLElement,
  options: StreamingRendererOptions = {}
): StreamingRenderer {
  const speedFactor = Math.max(0.05, options.speedFactor ?? 1)
  const signal = options.signal
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  element.setAttribute('data-streaming', 'true')
  const parser = smd.parser(makeRenderer(element, options.linkPrefix))

  let totalAccumulated = ''
  let pendingBuffer = ''
  let finishing = false
  let finished = false
  let rafHandle: number | null = null
  let resolveDone: () => void
  const done = new Promise<void>((resolve) => { resolveDone = resolve })

  const tracker = attachAutoScrollTracker(scroller)

  const writeSlice = (slice: string) => {
    if (!slice) return
    const stick = tracker.shouldStickToBottom()
    smd.parser_write(parser, slice)
    if (stick) scrollToBottom(scroller)
  }

  const cleanup = () => {
    if (finished) return
    finished = true
    if (rafHandle !== null) cancelAnimationFrame(rafHandle)
    rafHandle = null
    const userScrolledAway = tracker.isUserScrolledAway()
    tracker.detach()
    signal?.removeEventListener('abort', onAbort)
    element.setAttribute('data-streaming', 'false')
    // data-streaming off → the hidden actions bar rejoins layout and adds
    // height; re-pin so it appears in view for users tracking the stream.
    if (!userScrolledAway) {
      requestAnimationFrame(() => scrollToBottom(scroller))
    }
    resolveDone()
  }

  const flushAndClose = () => {
    if (rafHandle !== null) cancelAnimationFrame(rafHandle)
    rafHandle = null
    if (pendingBuffer.length > 0) {
      writeSlice(pendingBuffer)
      pendingBuffer = ''
    }
    smd.parser_end(parser)
    cleanup()
  }

  const onAbort = () => flushAndClose()

  if (signal) {
    if (signal.aborted) {
      smd.parser_end(parser)
      cleanup()
      return { update() {}, finish() {}, done }
    }
    signal.addEventListener('abort', onAbort)
  }

  // Reduced motion: bypass per-frame throttling entirely — accessibility
  // tools get the text immediately.
  if (prefersReducedMotion) {
    return {
      update(accumulated) {
        if (finished || accumulated.length <= totalAccumulated.length) return
        const delta = accumulated.slice(totalAccumulated.length)
        totalAccumulated = accumulated
        writeSlice(delta)
      },
      finish() {
        if (finished) return
        smd.parser_end(parser)
        cleanup()
      },
      done,
    }
  }

  // Reveal budget (chars), spent on WHOLE words so a half-built word never
  // flashes. A partial trailing word is held until the rest streams in.
  let budget = 0
  const isSpace = (c: string) => c === ' ' || c === '\n' || c === '\t' || c === '\r'

  /** End index (exclusive) of the next complete word + trailing whitespace,
   *  or -1 if none. With `flushTail`, the final run counts as complete. */
  const nextWordEnd = (flushTail: boolean): number => {
    const len = pendingBuffer.length
    let i = 0
    while (i < len && isSpace(pendingBuffer[i])) i++
    while (i < len && !isSpace(pendingBuffer[i])) i++
    if (i >= len) return flushTail ? len : -1
    while (i < len && isSpace(pendingBuffer[i])) i++
    return i
  }

  const tick = () => {
    rafHandle = null
    if (finished) return

    const rate = Math.min(
      MAX_CHARS_PER_FRAME,
      Math.max(MIN_CHARS_PER_FRAME, pendingBuffer.length / CATCHUP_FRAMES)
    )
    budget += rate * speedFactor

    for (;;) {
      const end = nextWordEnd(finishing)
      if (end <= 0 || end > budget) break
      const slice = pendingBuffer.slice(0, end)
      pendingBuffer = pendingBuffer.slice(end)
      budget -= end
      writeSlice(slice)
    }

    if (nextWordEnd(finishing) > 0) {
      rafHandle = requestAnimationFrame(tick)
      return
    }

    if (finishing && pendingBuffer.length === 0) {
      smd.parser_end(parser)
      cleanup()
    }
  }

  const schedule = () => {
    if (rafHandle !== null || finished) return
    if (pendingBuffer.length === 0) {
      if (finishing) {
        smd.parser_end(parser)
        cleanup()
      }
      return
    }
    rafHandle = requestAnimationFrame(tick)
  }

  return {
    update(accumulated) {
      if (finished || finishing) return
      if (accumulated.length <= totalAccumulated.length) return
      const delta = accumulated.slice(totalAccumulated.length)
      totalAccumulated = accumulated
      pendingBuffer += delta
      schedule()
    },
    finish(flushImmediately = false) {
      if (finished || finishing) return
      finishing = true
      if (flushImmediately) flushAndClose()
      else schedule()
    },
    done,
  }
}
