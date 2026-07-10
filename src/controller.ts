/**
 * Chat controller — wires panel, store, transport, renderer and message UI.
 *
 * Entry point: createChat(root) → { open, ask, dispose }. Loaded lazily by
 * the AIChat.astro shell on first interaction; dispose() is called on
 * astro:before-swap. All listeners are registered with one AbortController
 * signal so teardown is a single abort().
 *
 * The widget knows nothing about the host site: configuration (endpoints,
 * strings, chips) arrives as JSON in `data-acw-config`, and analytics-worthy
 * moments are announced as `acw:*` CustomEvents on `document` for the host
 * to forward wherever it likes.
 */

import { logger } from './logger'
import { createPanel, resetInput } from './panel'
import { sanitizeEndpoint, postChat, postFeedback, isSSEResponse, readSSEStream } from './transport'
import { createStreamingRenderer } from './render'
import { createStore, newMessageId } from './store'
import {
  addUserMessage, addAssistantMessage, replayConversation, attachMessageActions,
  addErrorNote, addSystemNote, showQuickReplies, hideQuickReplies,
} from './ui'
import type { FeedbackHandler } from './ui'
import type { ChatConfig, QuickReply } from './types'

export interface ChatApi {
  open(): void
  /** Open the panel and send a message programmatically (`acw:ask` event). */
  ask(text: string): void
  dispose(): void
}

export function createChat(root: HTMLElement): ChatApi {
  const config: ChatConfig = JSON.parse(root.dataset.acwConfig || '{}')
  const { strings, lang, linkPrefix } = config
  const endpoint = sanitizeEndpoint(config.endpoint, 'endpoint')
  const feedbackEndpoint = sanitizeEndpoint(config.feedbackEndpoint, 'feedbackEndpoint')
  const store = createStore(config)

  const dialog = root.querySelector<HTMLDialogElement>('.acw-panel')!
  const scroller = root.querySelector<HTMLElement>('.acw-messages')!
  const form = root.querySelector<HTMLFormElement>('.acw-form')!
  const input = root.querySelector<HTMLTextAreaElement>('.acw-input')!
  const sendButton = root.querySelector<HTMLButtonElement>('.acw-send')!
  const newChatButton = root.querySelector<HTMLButtonElement>('.acw-new')!
  const closeButton = root.querySelector<HTMLButtonElement>('.acw-close')!

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
  const emit = (name: 'acw:open' | 'acw:send' | 'acw:feedback', detail?: unknown) => {
    document.dispatchEvent(new CustomEvent(name, { detail }))
  }

  const hasUserMessages = () => conversation.messages.some((m) => m.role === 'user')

  const setStreaming = (on: boolean) => {
    streaming = on
    sendButton.classList.toggle('is-streaming', on)
    sendButton.setAttribute('aria-label', on ? strings.stop : strings.send)
    sendButton.title = on ? strings.stop : strings.send
  }

  // ── Feedback ─────────────────────────────────────────────────────────────

  const handleFeedback: FeedbackHandler = (messageId, rating, row) => {
    store.saveFeedbackRating(messageId, rating)
    emit('acw:feedback', { messageId, rating })
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
      messageId, rating, userPrompt, aiResponse, lang,
    })
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
    requestController = new AbortController()
    const message = addAssistantMessage(scroller, strings)
    let contentStarted = false
    let rawAccumulated = '' // raw markdown mirror of what the renderer got

    try {
      const response = await postChat(
        endpoint,
        { sessionId: convo.sessionId, message: text, lang },
        requestController.signal
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

      const content = message.startContent()
      contentStarted = true
      const renderer = createStreamingRenderer(content, scroller, {
        signal: requestController.signal,
        linkPrefix,
      })
      const result = await readSSEStream(
        response,
        (accumulated) => {
          rawAccumulated = accumulated
          renderer.update(accumulated)
        },
        requestController.signal
      )
      renderer.finish()
      await renderer.done
      if (convo !== conversation) {
        message.row.remove() // scroller was already cleared; drop the orphan
        return
      }

      if (result.text) {
        const id = newMessageId()
        convo.messages.push({ id, role: 'assistant', content: result.text, ts: Date.now() })
        store.save(convo)
        attachMessageActions(message.row, id, strings, store, handleFeedback)
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
        addErrorNote(scroller, strings.serverUnavailable, strings.retry, () => void request(text))
      }
    } catch (err) {
      const aborted = requestController.signal.aborted
      if (convo !== conversation) {
        message.row.remove()
        return
      }
      // Mid-stream network failure: keep what the user already read — the
      // raw markdown, so a replay re-renders it correctly.
      if (contentStarted && rawAccumulated) {
        const id = newMessageId()
        convo.messages.push({ id, role: 'assistant', content: rawAccumulated, ts: Date.now() })
        store.save(convo)
        attachMessageActions(message.row, id, strings, store, handleFeedback)
      } else {
        message.remove()
      }
      if (!aborted) {
        logger.error('request failed:', err)
        addErrorNote(scroller, strings.serverUnavailable, strings.retry, () => void request(text))
      }
    } finally {
      setStreaming(false)
      requestController = null
    }
  }

  async function send(text: string): Promise<void> {
    if (streaming || input.disabled) return
    const trimmed = text.trim()
    if (!trimmed) return

    hideQuickReplies(scroller)
    emit('acw:send', { text: trimmed })
    addUserMessage(scroller, trimmed)
    conversation.messages.push({ id: newMessageId(), role: 'user', content: trimmed, ts: Date.now() })
    store.save(conversation)
    resetInput(input)

    if (!endpoint) {
      addErrorNote(scroller, strings.serverUnavailable, strings.retry, () => void request(trimmed))
      return
    }
    await request(trimmed)
  }

  /** FAQ chip (a QuickReply with `answer`): canned markdown rendered locally —
   *  no request, no typing indicator, nothing to wait for. Same message shape
   *  as a backend answer, so persistence and replay need no special casing. */
  async function answerLocally(reply: QuickReply): Promise<void> {
    if (streaming || input.disabled) return
    const convo = conversation
    hideQuickReplies(scroller)
    emit('acw:send', { text: reply.text, local: true })
    addUserMessage(scroller, reply.text)
    // Persist both sides before the visual reveal (same rule as the greeting).
    convo.messages.push({ id: newMessageId(), role: 'user', content: reply.text, ts: Date.now() })
    const id = newMessageId()
    convo.messages.push({ id, role: 'assistant', content: reply.answer!, ts: Date.now() })
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
    attachMessageActions(message.row, id, strings, store, handleFeedback)
    if (reply.followUps?.length) {
      showQuickReplies(scroller, strings.quickLabel, pickReply, reply.followUps)
    }
  }

  /** Chip pick — the one branch point between FAQ entries and the backend. */
  function pickReply(reply: QuickReply): void {
    if (reply.answer) void answerLocally(reply)
    else void send(reply.text)
  }

  // ── Greeting / first render ──────────────────────────────────────────────

  async function streamGreeting(): Promise<void> {
    const convo = conversation
    // Persist BEFORE the visual reveal: the reveal is cosmetic, the data
    // isn't. An ask()/send() landing mid-reveal then appends AFTER the
    // greeting, and a rapid double "new chat" can't double-push (the stale
    // run's epoch check below stops it).
    convo.messages.push({
      id: newMessageId(), role: 'assistant', kind: 'greeting',
      content: strings.greeting, ts: Date.now(),
    })
    store.save(convo)

    const message = addAssistantMessage(scroller, strings)
    const content = message.startContent()
    const renderer = createStreamingRenderer(content, scroller, { speedFactor: 0.5, linkPrefix })
    renderer.update(strings.greeting)
    renderer.finish()
    await renderer.done
    if (convo !== conversation) {
      message.row.remove()
      return
    }
    // A programmatic ask() may have landed while the greeting streamed
    if (!hasUserMessages()) {
      showQuickReplies(scroller, strings.quickLabel, pickReply, config.quickReplies)
    }
  }

  function renderInitial(): void {
    if (rendered) return
    rendered = true
    if (conversation.messages.length > 0) {
      replayConversation(scroller, conversation, strings, store, handleFeedback, linkPrefix)
      if (!hasUserMessages()) {
        showQuickReplies(scroller, strings.quickLabel, pickReply, config.quickReplies)
      }
    } else {
      void streamGreeting()
    }
  }

  // ── Panel + wiring ───────────────────────────────────────────────────────

  const onSubmit = () => {
    if (streaming) {
      requestController?.abort() // send button doubles as Stop mid-stream
      return
    }
    void send(input.value)
  }

  const panel = createPanel(dialog, input, {
    onOpen() {
      emit('acw:open')
      renderInitial()
    },
    onSubmit,
  })

  form.addEventListener('submit', (e) => {
    e.preventDefault()
    onSubmit()
  }, { signal })

  closeButton.addEventListener('click', () => panel.close(), { signal })

  // Wide mode for reading long answers (desktop only; drag/resize would be
  // desktop-app UX — one toggle covers the real need)
  const expandButton = root.querySelector<HTMLButtonElement>('.acw-expand')
  expandButton?.addEventListener('click', () => {
    const wide = dialog.classList.toggle('is-wide')
    const label = wide ? strings.collapse : strings.expand
    expandButton.setAttribute('aria-label', label)
    expandButton.title = label
  }, { signal })

  newChatButton.addEventListener('click', () => {
    requestController?.abort()
    clearRateLimit()
    conversation = store.reset()
    scroller.textContent = ''
    void streamGreeting()
  }, { signal })

  return {
    open: () => panel.open(),
    ask(text: string) {
      panel.open()
      if (streaming || input.disabled) {
        // Busy (stream or rate limit): don't drop the question — park it in
        // the input so the user sends it when the widget frees up. The
        // synthetic input event triggers the textarea autosize (programmatic
        // .value assignment doesn't fire it on its own).
        input.value = text
        input.dispatchEvent(new Event('input', { bubbles: true }))
        return
      }
      void send(text)
    },
    dispose() {
      requestController?.abort()
      clearRateLimit()
      listeners.abort()
      panel.dispose()
    },
  }
}
