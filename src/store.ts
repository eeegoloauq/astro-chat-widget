/**
 * Persistence: ONE conversation in localStorage + per-message feedback map.
 *
 * One key, one flat shape, last-write-wins. A single conversation is a
 * deliberate design choice — no multi-chat sidebar, no cross-tab sync.
 * Storage failures (private mode, quota) degrade to an in-memory session.
 */

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  ts: number
  /** The canned greeting — replayed without copy/rating actions. */
  kind?: 'greeting'
}

export interface Conversation {
  sessionId: string
  messages: ChatMessage[]
  updatedAt: number
}

export interface ChatStore {
  load(): Conversation
  save(conversation: Conversation): void
  reset(): Conversation
  getFeedbackRating(messageId: string): 1 | -1 | null
  saveFeedbackRating(messageId: string, rating: 1 | -1): void
}

const EXPIRE_MS = 30 * 24 * 60 * 60 * 1000
const MAX_MESSAGES = 50

// crypto.randomUUID() exists only in secure contexts (https / localhost);
// accessing a dev server via LAN IP is plain http, so fall back to a v4
// UUID built from getRandomValues (available everywhere).
function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40 // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // variant 10
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export const newMessageId = (): string => uuid()

function emptyConversation(): Conversation {
  return { sessionId: uuid(), messages: [], updatedAt: Date.now() }
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null // private mode / disabled storage → in-memory session only
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* quota / private mode — chat still works, just doesn't persist */
  }
}

function remove(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {}
}

export function createStore(keys: { storageKey: string; feedbackStorageKey: string }): ChatStore {
  const KEY = keys.storageKey
  const FEEDBACK_KEY = keys.feedbackStorageKey

  function readConversation(): Conversation {
    const raw = read(KEY)
    if (raw) {
      try {
        const parsed = JSON.parse(raw)
        if (
          typeof parsed?.sessionId === 'string' &&
          Array.isArray(parsed?.messages) &&
          typeof parsed?.updatedAt === 'number' &&
          Date.now() - parsed.updatedAt < EXPIRE_MS
        ) {
          return parsed as Conversation
        }
      } catch {}
      remove(KEY) // corrupt or expired
    }
    return emptyConversation()
  }

  /** Feedback ratings outlive their messages otherwise (conversations expire
   *  in 30 days, ratings never) — drop entries for messages that are gone. */
  function pruneFeedback(conversation: Conversation): void {
    try {
      const raw = read(FEEDBACK_KEY)
      if (!raw) return
      const map = JSON.parse(raw)
      const alive = new Set(conversation.messages.map((m) => m.id))
      const pruned: Record<string, 1 | -1> = {}
      for (const [id, rating] of Object.entries(map)) {
        if (alive.has(id) && (rating === 1 || rating === -1)) pruned[id] = rating
      }
      write(FEEDBACK_KEY, JSON.stringify(pruned))
    } catch {
      remove(FEEDBACK_KEY)
    }
  }

  return {
    load() {
      const conversation = readConversation()
      pruneFeedback(conversation)
      return conversation
    },

    save(conversation) {
      conversation.updatedAt = Date.now()
      if (conversation.messages.length > MAX_MESSAGES) {
        conversation.messages = conversation.messages.slice(-MAX_MESSAGES)
      }
      write(KEY, JSON.stringify(conversation))
    },

    reset() {
      const fresh = emptyConversation()
      write(KEY, JSON.stringify(fresh))
      pruneFeedback(fresh)
      return fresh
    },

    getFeedbackRating(messageId) {
      try {
        const map = JSON.parse(read(FEEDBACK_KEY) || '{}')
        return map[messageId] === 1 || map[messageId] === -1 ? map[messageId] : null
      } catch {
        return null
      }
    },

    saveFeedbackRating(messageId, rating) {
      try {
        const map = JSON.parse(read(FEEDBACK_KEY) || '{}')
        map[messageId] = rating
        write(FEEDBACK_KEY, JSON.stringify(map))
      } catch {}
    },
  }
}
