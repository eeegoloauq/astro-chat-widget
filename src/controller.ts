/**
 * Chat controller — wires panel, screens, store, transport, renderer and
 * message UI.
 *
 * Entry point: createChat(root) → { open, ask, focusComposer, dispose }.
 * Loaded lazily by the AIChat.astro shell on first interaction; dispose() is
 * called on astro:before-swap. All listeners are registered with one
 * AbortController signal so teardown is a single abort().
 *
 * The widget knows nothing about the host site: configuration (endpoints,
 * strings, quick answers, guides) arrives as JSON in `data-acw-config`, and
 * analytics-worthy moments are announced as `acw:*` CustomEvents on
 * `document` for the host to forward wherever it likes.
 */

import { createHome } from './home'
import type { GuideOrigin } from './home'
import { isExternalUrl, isSafeContactUrl } from './links'
import { logger } from './logger'
import { openStateKey, savedScreen } from './openState'
import { createPanel, resetInput } from './panel'
import type { OpenOptions } from './panel'
import { scrollToBottom } from './scroll'
import { sanitizeEndpoint, postChat, postFeedback, isSSEResponse, readSSEStream } from './transport'
import { createStreamingRenderer } from './render'
import type { StreamingRenderer } from './render'
import { createStore, newMessageId } from './store'
import type { ChatMessage } from './store'
import {
  addUserMessage, addAssistantMessage, replayConversation, attachMessageActions,
  addErrorNote, addSystemNote, showQuickReplies, hideQuickReplies,
  addAnswerFooter, contactLink,
} from './ui'
import type { FeedbackHandler, UiContext } from './ui'
import type { ChatConfig, QuickReply } from './types'

export interface ChatApi {
  /** `restore: true` = reopening after a page navigation (instant, no focus steal). */
  open(opts?: OpenOptions): void
  /** Open the panel and send a message programmatically (`acw:ask` event). */
  ask(text: string): void
  /** Put the cursor in the composer (hotkey on an already open panel). */
  focusComposer(): void
  dispose(): void
}

type AcwEvent = 'acw:open' | 'acw:send' | 'acw:feedback' | 'acw:guide' | 'acw:contact'

const isMobile = () => window.matchMedia('(max-width: 768px)').matches

export function createChat(root: HTMLElement): ChatApi {
  const config: ChatConfig = JSON.parse(root.dataset.acwConfig || '{}')
  const { strings, lang, linkPrefix } = config
  const endpoint = sanitizeEndpoint(config.endpoint, 'endpoint')
  const feedbackEndpoint = sanitizeEndpoint(config.feedbackEndpoint, 'feedbackEndpoint')
  const contactUrl = config.contactUrl && isSafeContactUrl(config.contactUrl) ? config.contactUrl.trim() : ''
  if (config.contactUrl && !contactUrl) logger.error(`contactUrl blocked: unsafe URL ${config.contactUrl}`)
  const store = createStore(config)
  const openKey = openStateKey(config.storageKey)
  // Read before createHome(): its initial go('home') overwrites the saved value.
  const restoreScreen = savedScreen(openKey)

  const dialog = root.querySelector<HTMLDialogElement>('.acw-panel')!
  const fab = root.querySelector<HTMLElement>('.acw-fab')!
  const scroller = root.querySelector<HTMLElement>('.acw-messages')!
  const liveRegion = root.querySelector<HTMLElement>('.acw-live')!
  const form = root.querySelector<HTMLFormElement>('.acw-form')!
  const input = root.querySelector<HTMLTextAreaElement>('.acw-input')!
  const sendButton = root.querySelector<HTMLButtonElement>('.acw-send')!
  const newChatButton = root.querySelector<HTMLButtonElement>('.acw-new')!
  const confirmBox = root.querySelector<HTMLElement>('.acw-confirm')!
  const confirmYes = root.querySelector<HTMLButtonElement>('.acw-confirm-yes')!
  const confirmNo = root.querySelector<HTMLButtonElement>('.acw-confirm-no')!

  let conversation = store.load()
  let streaming = false
  let requestController: AbortController | null = null
  let rendered = false // message list built (on first open)

  // Rate-limit state
  let rateLimitTimer: number | null = null
  let rateLimitNote: HTMLElement | null = null

  // Every listener hangs off this signal — dispose() is one abort().
  const listeners = new AbortController()
  const signal = listeners.signal

  /** Host-page analytics hook: `document.addEventListener('acw:open', ...)`. */
  const emit = (name: AcwEvent, detail?: unknown) => {
    document.dispatchEvent(new CustomEvent(name, { detail }))
  }

  const lastQuestion = () =>
    [...conversation.messages].reverse().find((m) => m.role === 'user')?.content ?? null

  /** Screen-reader announcement. The message list is deliberately NOT a live
   *  region (it would stutter through the stream word by word) — finished
   *  answers are announced whole via the hidden role=status element. */
  const announce = (text: string) => {
    liveRegion.textContent = text
  }

  /** Closing the panel doesn't abort the stream — an answer (or error) that
   *  lands while it's closed lights the FAB dot; opening clears it. */
  const markUnread = () => {
    if (!dialog.open) fab.classList.add('has-unread')
  }

  const setStreaming = (on: boolean) => {
    streaming = on
    sendButton.classList.toggle('is-streaming', on)
    sendButton.setAttribute('aria-label', on ? strings.stop : strings.send)
    sendButton.title = on ? strings.stop : strings.send
  }

  /** A guide link was followed. On phones the sheet would cover the page the
   *  visitor is about to read, so it steps aside (desktop keeps it open and
   *  the reopen-after-navigation flag carries it to the next page). */
  const onGuide = (href: string, from: GuideOrigin | 'sources', external: boolean) => {
    emit('acw:guide', { href, from })
    if (isMobile() && !external) panel.close()
  }

  // ── Feedback ─────────────────────────────────────────────────────────────

  const handleFeedback: FeedbackHandler = (messageId, rating, row, reason) => {
    if (!reason) store.saveFeedbackRating(messageId, rating)
    emit('acw:feedback', { messageId, rating, reason: reason ?? null })
    const index = conversation.messages.findIndex((m) => m.id === messageId)
    const aiResponse = index >= 0
      ? conversation.messages[index].content
      : row.querySelector('.acw-msg-content')?.textContent || ''
    let userPrompt = ''
    for (let i = index - 1; i >= 0; i--) {
      if (conversation.messages[i].role === 'user') {
        userPrompt = conversation.messages[i].content
        break
      }
    }
    void postFeedback(feedbackEndpoint, {
      sessionId: conversation.sessionId,
      messageId, rating, userPrompt, aiResponse, lang, reason: reason ?? null,
    })
  }

  const ui: UiContext = {
    strings,
    store,
    onFeedback: handleFeedback,
    contactUrl,
    linkPrefix,
    onLink(kind, href) {
      if (kind === 'contact') emit('acw:contact', { href })
      else onGuide(href, 'sources', isExternalUrl(href, window.location.origin))
    },
  }

  // ── Rate limiting (429) ──────────────────────────────────────────────────

  const rateLimitText = (seconds: number) => strings.rateLimit.replace('{s}', String(seconds))

  const clearRateLimit = () => {
    if (rateLimitTimer !== null) clearInterval(rateLimitTimer)
    rateLimitTimer = null
    rateLimitNote?.remove()
    rateLimitNote = null
    input.disabled = false
    sendButton.disabled = false
  }

  const handleRateLimit = (retryAfterHeader: string | null) => {
    clearRateLimit()
    let remaining = Math.max(1, parseInt(retryAfterHeader || '', 10) || 30)
    input.disabled = true
    sendButton.disabled = true
    rateLimitNote = addSystemNote(scroller, rateLimitText(remaining))
    rateLimitTimer = window.setInterval(() => {
      remaining--
      if (remaining <= 0) {
        clearRateLimit()
        input.focus()
      } else if (rateLimitNote) {
        rateLimitNote.textContent = rateLimitText(remaining)
      }
    }, 1000)
  }

  const errorNote = (text: string) => {
    addErrorNote(scroller, strings.serverUnavailable, strings.retry, () => void request(text), contactLink(ui))
    markUnread()
  }

  /** Persist a finished assistant answer and give it its footer + actions. */
  const finishAnswer = (
    row: HTMLElement,
    content: HTMLElement,
    message: Omit<ChatMessage, 'id' | 'role' | 'ts'>
  ) => {
    const id = newMessageId()
    const ts = Date.now()
    conversation.messages.push({ id, role: 'assistant', ts, ...message })
    store.save(conversation)
    addAnswerFooter(row, message, ui)
    attachMessageActions(row, id, ui, ts)
    announce(content.textContent || '')
    markUnread()
  }

  // ── Send / stream ────────────────────────────────────────────────────────

  /** Network + streaming part. Retry re-enters here without re-adding the
   *  user bubble.
   *
   *  Epoch guard: `convo` pins the conversation this request belongs to.
   *  "New chat" mid-stream aborts the fetch, but readSSEStream returns
   *  NORMALLY on abort (that's how Stop saves partials) — so every push/save
   *  after an await must check the epoch, or a stale partial would be written
   *  into the freshly reset conversation. */
  async function request(text: string): Promise<void> {
    if (streaming) return // a stale error-note Retry must not start a parallel stream
    const convo = conversation
    setStreaming(true)
    const controller = new AbortController()
    requestController = controller
    const message = addAssistantMessage(scroller, strings)
    announce(strings.thinking)
    let contentStarted = false
    let rawAccumulated = '' // raw markdown mirror of what the renderer got
    let renderer: StreamingRenderer | null = null

    try {
      const response = await postChat(
        endpoint,
        { sessionId: convo.sessionId, message: text, lang },
        controller.signal
      )
      if (convo !== conversation) {
        message.remove()
        return
      }

      if (response.status === 429) {
        message.remove()
        handleRateLimit(response.headers.get('retry-after'))
        return
      }
      if (!response.ok || !isSSEResponse(response) || !response.body) {
        throw new Error(`HTTP ${response.status}`)
      }

      const stream = createStreamingRenderer(message.content, scroller, {
        signal: controller.signal,
        linkPrefix,
      })
      renderer = stream
      const result = await readSSEStream(
        response,
        (accumulated) => {
          // Swap the typing indicator on the FIRST TOKEN, not on response
          // headers: an LLM backend opens the stream immediately and thinks
          // for seconds before the first chunk — the dots must cover that
          // gap, or the answer appears out of a blank row.
          if (!contentStarted) {
            message.startContent()
            contentStarted = true
          }
          rawAccumulated = accumulated
          stream.update(accumulated)
        },
        controller.signal
      )
      stream.finish()
      await stream.done
      if (convo !== conversation) {
        message.row.remove() // scroller was already cleared; drop the orphan
        return
      }

      // readSSEStream returns normally on abort: the visitor pressed Stop, and
      // the answer keeps only what was on screen.
      const stopped = controller.signal.aborted
      const answer = stopped ? stream.shown() : result.text
      if (answer) {
        finishAnswer(message.row, message.content, {
          content: answer,
          ...(result.sources?.length ? { sources: result.sources } : {}),
          ...(result.handoff ? { handoff: true } : {}),
          ...(stopped ? { stopped: true } : {}),
        })
        // Backend follow-up suggestions (optional in the done-event) become
        // quick-reply chips under the answer. Not persisted: they belong to
        // the moment, a replayed conversation shouldn't resurrect them.
        if (result.suggestions?.length) {
          showQuickReplies(
            scroller, strings.quickLabel, pickReply,
            result.suggestions.map((text) => ({ text }))
          )
        }
      } else {
        message.remove()
      }
      if (result.error) {
        logger.error('backend error event:', result.error)
        errorNote(text)
      }
    } catch (err) {
      const aborted = controller.signal.aborted
      if (convo !== conversation) {
        message.row.remove()
        return
      }
      // Mid-stream network failure or Stop: keep what the user already read —
      // the raw markdown, so a replay re-renders it correctly.
      const kept = aborted && renderer ? renderer.shown() : rawAccumulated
      if (contentStarted && kept) {
        finishAnswer(message.row, message.content, {
          content: kept,
          ...(aborted ? { stopped: true } : {}),
        })
      } else {
        message.remove()
      }
      if (!aborted) {
        logger.error('request failed:', err)
        errorNote(text)
      }
    } finally {
      setStreaming(false)
      requestController = null
    }
  }

  /** Common start of every question: leave home, show the user bubble. */
  function startTurn(text: string, local: boolean): void {
    home.go('chat')
    renderInitial()
    hideQuickReplies(scroller)
    emit('acw:send', local ? { text, local: true } : { text })
    const ts = Date.now()
    addUserMessage(scroller, text, ts)
    conversation.messages.push({ id: newMessageId(), role: 'user', content: text, ts })
    store.save(conversation)
    home.setLastQuestion(text)
  }

  async function send(text: string): Promise<void> {
    if (streaming || input.disabled) return
    const trimmed = text.trim()
    if (!trimmed) return
    startTurn(trimmed, false)
    resetInput(input)

    if (!endpoint) {
      addErrorNote(scroller, strings.serverUnavailable, strings.retry, () => void request(trimmed), contactLink(ui))
      return
    }
    await request(trimmed)
  }

  /** FAQ entry (a QuickReply with `answer`): canned markdown rendered locally —
   *  no request, no typing indicator, nothing to wait for. Same message shape
   *  as a backend answer, so persistence and replay need no special casing. */
  async function answerLocally(reply: QuickReply): Promise<void> {
    if (streaming || input.disabled) return
    const convo = conversation
    startTurn(reply.text, true)
    // Persist before the visual reveal: a question sent mid-reveal must land
    // after this answer, not before it.
    const id = newMessageId()
    const ts = Date.now()
    convo.messages.push({ id, role: 'assistant', content: reply.answer!, ts, local: true })
    store.save(convo)

    const message = addAssistantMessage(scroller, strings)
    const content = message.startContent() // swap the indicator out immediately
    const renderer = createStreamingRenderer(content, scroller, { speedFactor: 0.5, linkPrefix })
    renderer.update(reply.answer!)
    renderer.finish()
    await renderer.done
    if (convo !== conversation) {
      message.row.remove()
      return
    }
    attachMessageActions(message.row, id, ui, ts)
    announce(content.textContent || '')
    markUnread()
    if (reply.followUps?.length) {
      showQuickReplies(scroller, strings.quickLabel, pickReply, reply.followUps)
    }
  }

  /** Quick-answer pick — the one branch point between FAQ entries and the backend. */
  function pickReply(reply: QuickReply): void {
    if (reply.answer) void answerLocally(reply)
    else void send(reply.text)
  }

  // ── First render ─────────────────────────────────────────────────────────

  function renderInitial(): void {
    if (rendered) return
    rendered = true
    replayConversation(scroller, conversation, ui)
  }

  // ── Panel + wiring ───────────────────────────────────────────────────────

  const onSubmit = () => {
    if (streaming) {
      requestController?.abort() // send button doubles as Stop mid-stream
      return
    }
    void send(input.value)
  }

  const home = createHome(dialog, input, config, {
    onReply: pickReply,
    onAsk: onSubmit,
    onGuide: (href, from, external) => onGuide(href, from, external),
  }, openKey)
  home.setLastQuestion(lastQuestion())

  const panel = createPanel(dialog, input, {
    onOpen(restored) {
      fab.classList.remove('has-unread')
      emit('acw:open', { restored })
      renderInitial()
      if (restored && restoreScreen) home.go(restoreScreen)
      // Every open lands at the newest message (messenger convention) — while
      // the panel is closed the scroller has no layout, so an answer that
      // streamed in the background would otherwise sit below the fold.
      scrollToBottom(scroller)
    },
    onSubmit,
  }, openKey)

  form.addEventListener('submit', (e) => {
    e.preventDefault()
    onSubmit()
  }, { signal })

  input.addEventListener('input', () => home.onInput(input.value), { signal })

  root.querySelectorAll<HTMLButtonElement>('.acw-close').forEach((button) =>
    button.addEventListener('click', () => panel.close(), { signal })
  )

  // New chat deletes the only copy of the conversation, so it asks first.
  const hideConfirm = () => {
    confirmBox.hidden = true
  }
  newChatButton.addEventListener('click', () => {
    confirmBox.hidden = false
    confirmNo.focus()
  }, { signal })
  confirmNo.addEventListener('click', () => {
    hideConfirm()
    newChatButton.focus()
  }, { signal })
  confirmYes.addEventListener('click', () => {
    hideConfirm()
    requestController?.abort()
    clearRateLimit()
    conversation = store.reset()
    scroller.textContent = ''
    home.setLastQuestion(null)
    home.go('home', { focus: true })
  }, { signal })

  return {
    open: (opts) => panel.open(opts),
    ask(text: string) {
      panel.open()
      if (streaming || input.disabled) {
        // Busy (stream or rate limit): don't drop the question — park it in
        // the input so the user sends it when the widget frees up. The
        // synthetic input event triggers the textarea autosize (programmatic
        // .value assignment doesn't fire it on its own).
        home.go('chat')
        input.value = text
        input.dispatchEvent(new Event('input', { bubbles: true }))
        return
      }
      void send(text)
    },
    focusComposer() {
      if (!input.disabled) input.focus()
    },
    dispose() {
      requestController?.abort()
      clearRateLimit()
      listeners.abort()
      home.dispose()
      panel.dispose()
    },
  }
}
