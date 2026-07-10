/**
 * DOM builders for the message list: bubbles, typing indicator, message
 * actions (copy / thumbs), error + system notes, quick-reply chips.
 *
 * Everything is built with createElement + textContent — no innerHTML with
 * interpolated data anywhere. Layout notes live in styles/messages.css.
 */

import { renderMarkdownOneShot } from './render'
import { scrollToBottom } from './scroll'
import type { ChatStore, Conversation } from './store'
import type { ChatStrings, LinkPrefix, QuickReply } from './types'

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

// ── Messages ───────────────────────────────────────────────────────────────

/** Sent-at tooltip (browser locale). Hover-only: zero visual noise, and the
 *  data was in the store all along. */
const timeTitle = (ts: number) =>
  new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export function addUserMessage(scroller: HTMLElement, text: string, ts?: number): void {
  const row = el('div', 'acw-msg acw-msg--user')
  const bubble = el('div', 'acw-msg-bubble', text)
  if (ts) bubble.title = timeTitle(ts)
  row.appendChild(bubble)
  scroller.appendChild(row)
  scrollToBottom(scroller)
}

export interface AssistantMessage {
  row: HTMLElement
  /** Markdown target — hand this to the streaming renderer. */
  content: HTMLElement
  /** Swap the typing indicator for the (empty) content element. */
  startContent(): HTMLElement
  /** Remove the whole row (request failed before any content). */
  remove(): void
}

/**
 * Append an assistant row showing the typing indicator. The indicator swaps
 * a "thinking" label for "taking longer than usual" after 8s.
 */
export function addAssistantMessage(scroller: HTMLElement, strings: ChatStrings): AssistantMessage {
  const row = el('div', 'acw-msg acw-msg--assistant')
  const content = el('div', 'acw-msg-content')

  const typing = el('div', 'acw-typing')
  typing.setAttribute('aria-label', strings.thinking)
  const dots = el('span', 'acw-typing-dots')
  for (let i = 0; i < 3; i++) dots.appendChild(el('i', ''))
  const label = el('span', 'acw-typing-label', strings.thinking)
  typing.append(dots, label)
  const longTimer = window.setTimeout(() => { label.textContent = strings.thinkingLong }, 8000)

  row.appendChild(typing)
  scroller.appendChild(row)
  scrollToBottom(scroller)

  return {
    row,
    content,
    startContent() {
      clearTimeout(longTimer)
      typing.remove()
      row.appendChild(content)
      return content
    },
    remove() {
      clearTimeout(longTimer)
      row.remove()
    },
  }
}

/** Replay a stored conversation (one-shot markdown, no reveal). */
export function replayConversation(
  scroller: HTMLElement,
  conversation: Conversation,
  strings: ChatStrings,
  store: ChatStore,
  onFeedback: FeedbackHandler,
  linkPrefix?: LinkPrefix
): void {
  scroller.textContent = ''
  for (const message of conversation.messages) {
    if (message.role === 'user') {
      addUserMessage(scroller, message.content, message.ts)
    } else {
      const row = el('div', 'acw-msg acw-msg--assistant')
      const content = el('div', 'acw-msg-content')
      renderMarkdownOneShot(content, message.content, linkPrefix)
      row.appendChild(content)
      scroller.appendChild(row)
      // The canned greeting is not an answer — nothing to copy or rate.
      // (content fallback covers conversations stored before `kind` existed)
      if (message.kind !== 'greeting' && message.content !== strings.greeting) {
        attachMessageActions(row, message.id, strings, store, onFeedback, message.ts)
      }
    }
  }
  scrollToBottom(scroller)
}

// ── Message actions (copy + thumbs) ────────────────────────────────────────

export type FeedbackHandler = (messageId: string, rating: 1 | -1, row: HTMLElement) => void

const THUMB_UP_PATH = 'M7 10v12h10.3a2 2 0 0 0 2-1.7l1.4-8a2 2 0 0 0-2-2.3H13l1-4.5A1.8 1.8 0 0 0 12.2 3L7 10zM3 10h4v12H3z'
const THUMB_DOWN_PATH = 'M17 14V2H6.7a2 2 0 0 0-2 1.7l-1.4 8a2 2 0 0 0 2 2.3H11l-1 4.5A1.8 1.8 0 0 0 11.8 21L17 14zm4 0h-4V2h4z'

function iconButton(className: string, label: string, svgPath: string): HTMLButtonElement {
  const button = el('button', className)
  button.type = 'button'
  button.setAttribute('aria-label', label)
  button.title = label
  button.innerHTML =
    `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${svgPath}"/></svg>`
  return button
}

/**
 * Clipboard write that also works in insecure contexts (plain-http LAN dev),
 * where navigator.clipboard is undefined. The textarea is parented inside the
 * dialog so the selection stays within the top layer. Resolves to the honest
 * outcome — the checkmark must not show for a rejected write.
 */
async function copyToClipboard(text: string, host: HTMLElement): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      return false
    }
  }
  const scratch = document.createElement('textarea')
  scratch.value = text
  scratch.style.cssText = 'position:fixed;opacity:0;pointer-events:none'
  host.appendChild(scratch)
  scratch.select()
  try {
    return document.execCommand('copy')
  } finally {
    scratch.remove()
  }
}

/**
 * Copy + like/dislike bar under an assistant message. A saved rating renders
 * pre-selected and locked. `ts` (when known) becomes the row's hover tooltip —
 * this runs at every finalize point, so the timestamp rides along.
 */
export function attachMessageActions(
  row: HTMLElement,
  messageId: string,
  strings: ChatStrings,
  store: ChatStore,
  onFeedback: FeedbackHandler,
  ts?: number
): void {
  if (ts) row.title = timeTitle(ts)
  const bar = el('div', 'acw-msg-actions')

  const copy = el('button', 'acw-action acw-action--copy')
  copy.type = 'button'
  copy.setAttribute('aria-label', strings.copy)
  copy.title = strings.copy
  copy.innerHTML =
    '<svg class="acw-copy-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
    '<path d="M8 8V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2M6 8h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z"/></svg>' +
    '<svg class="acw-check-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">' +
    '<path d="M20 6L9 17l-5-5"/></svg>'
  copy.addEventListener('click', async () => {
    const content = row.querySelector('.acw-msg-content')
    if (!content?.textContent) return
    if (!(await copyToClipboard(content.textContent, row))) return
    copy.classList.add('is-done')
    copy.title = strings.copied
    setTimeout(() => {
      copy.classList.remove('is-done')
      copy.title = strings.copy
    }, 1500)
  })

  const like = iconButton('acw-action acw-action--like', strings.helpful, THUMB_UP_PATH)
  const dislike = iconButton('acw-action acw-action--dislike', strings.notHelpful, THUMB_DOWN_PATH)

  const lockRating = (rating: 1 | -1) => {
    like.disabled = true
    dislike.disabled = true
    ;(rating === 1 ? like : dislike).classList.add('is-selected')
  }

  const saved = store.getFeedbackRating(messageId)
  if (saved) {
    lockRating(saved)
  } else {
    like.addEventListener('click', () => { lockRating(1); onFeedback(messageId, 1, row) })
    dislike.addEventListener('click', () => { lockRating(-1); onFeedback(messageId, -1, row) })
  }

  bar.append(copy, like, dislike)
  row.appendChild(bar)
}

// ── Notes (errors, rate limit) ─────────────────────────────────────────────

export function addErrorNote(
  scroller: HTMLElement,
  text: string,
  retryLabel: string,
  onRetry: () => void
): HTMLElement {
  const note = el('div', 'acw-note acw-note--error')
  note.setAttribute('role', 'alert')
  note.appendChild(el('span', '', text))
  const retry = el('button', 'acw-note-retry', retryLabel)
  retry.type = 'button'
  retry.addEventListener('click', () => {
    note.remove()
    onRetry()
  }, { once: true })
  note.appendChild(retry)
  scroller.appendChild(note)
  scrollToBottom(scroller)
  return note
}

/** Plain informational note; caller updates textContent / removes it. */
export function addSystemNote(scroller: HTMLElement, text: string): HTMLElement {
  const note = el('div', 'acw-note', text)
  note.setAttribute('role', 'status')
  scroller.appendChild(note)
  scrollToBottom(scroller)
  return note
}

// ── Quick replies (appended to the message flow) ───────────────────────────
// Three sources, one widget: the configured starter chips under the greeting,
// backend follow-up suggestions from the SSE done-event after an answer, and
// `followUps` of a local FAQ entry (a chip with a canned `answer`). The pick
// handler receives the full QuickReply — the controller decides whether it
// answers locally or goes to the backend.

export function showQuickReplies(
  scroller: HTMLElement,
  label: string,
  onPick: (reply: QuickReply) => void,
  items: QuickReply[]
): void {
  hideQuickReplies(scroller)
  if (items.length === 0) return

  const container = el('div', 'acw-chips')
  container.setAttribute('role', 'group')
  container.setAttribute('aria-label', label)

  items.forEach((reply, index) => {
    const chip = el('button', 'acw-chip')
    chip.type = 'button'
    chip.style.transitionDelay = `${index * 50}ms`
    if (reply.emoji) chip.appendChild(el('span', 'acw-chip-emoji', reply.emoji))
    chip.appendChild(el('span', '', reply.text))
    chip.addEventListener('click', () => onPick(reply), { once: true })
    container.appendChild(chip)
  })

  scroller.appendChild(container)
  requestAnimationFrame(() => {
    scrollToBottom(scroller)
    container.classList.add('is-visible')
  })
}

export function hideQuickReplies(scroller: HTMLElement): void {
  scroller.querySelector('.acw-chips')?.remove()
}
