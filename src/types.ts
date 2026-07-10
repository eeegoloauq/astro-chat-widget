/**
 * Public configuration types. The AIChat.astro shell resolves props against
 * defaults and serializes a complete ChatConfig into `data-acw-config`; the
 * runtime module never touches props or environment variables directly.
 */

/** A quick-reply chip. Starter chips come from config; follow-up chips from
 *  the backend's SSE done-event. */
export interface QuickReply {
  text: string
  emoji?: string
}

/** Every user-facing string in the widget. All optional at the prop level —
 *  unset keys fall back to English (see defaults.ts). */
export interface ChatStrings {
  /** Panel header title. */
  title: string
  /** aria-label of the floating action button. */
  buttonLabel: string
  /** Composer placeholder (also its aria-label). */
  placeholder: string
  /** Small print under the composer. */
  disclaimer: string
  /** First assistant message, streamed on a fresh conversation. */
  greeting: string
  thinking: string
  /** Swapped in when a response takes longer than 8s. */
  thinkingLong: string
  retry: string
  copy: string
  copied: string
  helpful: string
  notHelpful: string
  serverUnavailable: string
  /** Shown on HTTP 429; `{s}` is replaced with the remaining seconds. */
  rateLimit: string
  /** aria-label of the quick-replies group. */
  quickLabel: string
  send: string
  stop: string
  newChat: string
  close: string
  expand: string
  collapse: string
}

/**
 * Rewriting of root-relative links in assistant markdown — for i18n sites
 * whose internal URLs carry a locale prefix. `{ add: '/en', skip: ['/en', '/ru'] }`
 * turns `/catalog/x` into `/en/catalog/x` and leaves `/ru/catalog/x` alone.
 */
export interface LinkPrefix {
  /** Prefix added to root-relative hrefs. */
  add: string
  /** Prefixes that mark a link as already localized. Defaults to `[add]`. */
  skip?: string[]
}

/** Fully-resolved runtime configuration (what `data-acw-config` carries). */
export interface ChatConfig {
  /** Chat endpoint. POST JSON, responds with SSE — see README for the protocol. */
  endpoint: string
  /** Optional feedback endpoint. Thumbs are hidden-in-effect without it
   *  (ratings still persist locally). */
  feedbackEndpoint: string
  /** Sent to the backend with every message. */
  lang: string
  strings: ChatStrings
  /** Starter chips under the greeting. Empty array → no starter chips. */
  quickReplies: QuickReply[]
  linkPrefix?: LinkPrefix
  /** localStorage key for the conversation. */
  storageKey: string
  /** localStorage key for the per-message feedback map. */
  feedbackStorageKey: string
}
