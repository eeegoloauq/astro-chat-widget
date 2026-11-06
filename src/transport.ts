/**
 * Network layer: POST to the chat endpoint, consume the SSE response.
 *
 * Protocol:
 *   request  — JSON { sessionId, message, timestamp, lang }
 *   response — text/event-stream of `data: {...}` lines:
 *                { chunk: "..." }  incremental text
 *                { done: true, suggestions?: ["...", ...],
 *                  sources?: [{ title, href }], handoff?: boolean }
 *                                  end of answer; optional follow-up
 *                                  questions rendered as quick-reply chips,
 *                                  links to the pages the answer came from,
 *                                  and a request to offer the contact link
 *                { error: "..." }  server-side failure
 *
 * EventSource can't POST, so this is fetch + ReadableStream. The stream is
 * truncated at MAX_MESSAGE_SIZE and the reader cancelled to bound memory.
 */

import { isSafeUrl } from './links'
import { logger } from './logger'
import type { FeedbackReason, Source } from './types'

/** Maximum single message content size in characters (~50KB). */
export const MAX_MESSAGE_SIZE = 50_000

/**
 * Validate an endpoint once at init. Returns '' (endpoint disabled) on an
 * unparseable URL, or plain http to a non-localhost host in a production
 * build — a chat widget must not ship credentials-adjacent traffic over
 * cleartext because of a config typo.
 */
export function sanitizeEndpoint(url: string, name: string): string {
  if (!url) return ''
  try {
    // Relative URLs (/api/chat) resolve against the page origin. This module
    // only runs in the browser.
    const parsed = new URL(url, window.location.origin)
    const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
    const isDev = typeof import.meta.env !== 'undefined' && !!import.meta.env.DEV
    if (parsed.protocol === 'http:' && !isLocalhost && !isDev) {
      logger.error(`${name} blocked: HTTPS required in production. Got: ${url}`)
      return ''
    }
    return url
  } catch {
    logger.error(`${name} is not a valid URL: ${url}`)
    return ''
  }
}

export function postChat(
  endpoint: string,
  payload: { sessionId: string; message: string; lang: string },
  signal: AbortSignal
): Promise<Response> {
  return fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, timestamp: new Date().toISOString() }),
    signal,
  })
}

export function isSSEResponse(response: Response): boolean {
  return (response.headers.get('content-type') || '').includes('text/event-stream')
}

interface SSEEvent {
  chunk?: string
  done?: boolean
  error?: string
  suggestions?: unknown
  sources?: unknown
  handoff?: unknown
}

export interface StreamResult {
  text: string
  error?: string
  suggestions?: string[]
  sources?: Source[]
  handoff?: boolean
}

const MAX_SUGGESTIONS = 3
const MAX_SUGGESTION_LENGTH = 80

/** Backend text → chip labels: strings only, trimmed, capped in count and length. */
function sanitizeSuggestions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((s): s is string => typeof s === 'string')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= MAX_SUGGESTION_LENGTH)
    .slice(0, MAX_SUGGESTIONS)
}

const MAX_SOURCES = 3
const MAX_SOURCE_TITLE = 80

/** Backend links → { title, href } with a safe scheme; anything else is dropped. */
function sanitizeSources(raw: unknown): Source[] {
  if (!Array.isArray(raw)) return []
  const out: Source[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const { title, href } = item as Record<string, unknown>
    if (typeof title !== 'string' || typeof href !== 'string') continue
    const cleanTitle = title.trim().slice(0, MAX_SOURCE_TITLE)
    const cleanHref = href.trim()
    if (!cleanTitle || !isSafeUrl(cleanHref)) continue
    out.push({ title: cleanTitle, href: cleanHref })
    if (out.length === MAX_SOURCES) break
  }
  return out
}

/** Parse complete `data: {...}` lines. Malformed JSON is skipped with a warning. */
function parseSSELines(text: string): SSEEvent[] {
  const events: SSEEvent[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data: ')) continue
    try {
      events.push(JSON.parse(trimmed.slice(6)))
    } catch {
      logger.warn('[SSE] failed to parse:', trimmed)
    }
  }
  return events
}

/**
 * Consume the SSE body. Calls `onChunk` with the ACCUMULATED text after every
 * chunk event; resolves on `done: true`, body end, or an `error` event.
 */
export async function readSSEStream(
  response: Response,
  onChunk: (accumulated: string) => void,
  signal: AbortSignal
): Promise<StreamResult> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let accumulated = ''
  let sseBuffer = ''

  try {
    while (true) {
      if (signal.aborted) {
        reader.cancel()
        break
      }
      const { done, value } = await reader.read()
      if (done) break

      sseBuffer += decoder.decode(value, { stream: true })

      // Only complete lines are parseable; hold the partial tail.
      const lastNewline = sseBuffer.lastIndexOf('\n')
      if (lastNewline === -1) continue
      const completeLines = sseBuffer.slice(0, lastNewline + 1)
      sseBuffer = sseBuffer.slice(lastNewline + 1)

      for (const event of parseSSELines(completeLines)) {
        if (event.error) return { text: accumulated, error: event.error }
        if (event.done) {
          return {
            text: accumulated,
            suggestions: sanitizeSuggestions(event.suggestions),
            sources: sanitizeSources(event.sources),
            handoff: event.handoff === true,
          }
        }
        if (event.chunk) {
          accumulated += event.chunk
          if (accumulated.length > MAX_MESSAGE_SIZE) {
            reader.cancel()
            const truncated = accumulated.slice(0, MAX_MESSAGE_SIZE) + '\n\n[Response truncated]'
            onChunk(truncated) // what gets stored must be what was shown
            return { text: truncated }
          }
          onChunk(accumulated)
        }
      }
    }
  } catch (err) {
    if (signal.aborted) return { text: accumulated }
    throw err
  }

  return { text: accumulated }
}

/** Fire-and-forget-with-result feedback POST. */
export async function postFeedback(
  endpoint: string,
  payload: {
    sessionId: string
    messageId: string
    rating: 1 | -1
    userPrompt: string
    aiResponse: string
    lang: string
    /** Set on the second POST after a thumbs-down; backends upsert by messageId. */
    reason?: FeedbackReason | null
  }
): Promise<boolean> {
  if (!endpoint) return false
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: null, ...payload, comment: null, timestamp: new Date().toISOString() }),
    })
    return response.ok
  } catch (err) {
    logger.error('feedback POST failed:', err)
    return false
  }
}
