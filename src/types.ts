/**
 * Public configuration types. The AIChat.astro shell resolves props against
 * defaults and serializes a complete ChatConfig into `data-acw-config`; the
 * runtime module never touches props or environment variables directly.
 */

/** A quick-reply chip. Starter chips come from config; follow-up chips from
 *  the backend's SSE done-event. A chip with `answer` is a local FAQ entry:
 *  picking it renders the canned markdown instantly — no backend round trip —
 *  and offers its `followUps` as the next chips (an FAQ tree). Chips without
 *  `answer` send their text to the backend as a normal message. */
export interface QuickReply {
  text: string
  emoji?: string
  /** Canned markdown answer — makes the chip a local FAQ entry. */
  answer?: string
  /** Chips offered under the canned answer. */
  followUps?: QuickReply[]
}

/** A guide listed on the home screen and found by the composer search.
 *  Links navigate the host page; an open panel follows on desktop. */
export interface Article {
  title: string
  href: string
  /** Reading time, shown as `readTime`. */
  minutes?: number
  /** Extra words the composer search matches, e.g. 'color brand css'. */
  keywords?: string
}

/** A page an answer came from (SSE `done.sources`). */
export interface Source {
  title: string
  href: string
}

/** Thumbs-down reason sent with the second feedback POST. */
export type FeedbackReason = 'wrong' | 'off-topic' | 'outdated'

/** Every user-facing string in the widget. All optional at the prop level —
 *  unset keys fall back to English (see defaults.ts). */
export interface ChatStrings {
  /** Panel header title (also the dialog's accessible name). */
  title: string
  /** Badge after the title; empty string hides it. */
  aiBadge: string
  /** aria-label of the floating action button. */
  buttonLabel: string
  /** Composer placeholder on the home screen (also its aria-label). */
  placeholder: string
  /** Composer placeholder inside a conversation. */
  placeholderFollowUp: string
  /** Small print under the composer, shown in the conversation. */
  disclaimer: string
  /** Home screen heading. */
  greeting: string
  /** Home section headings. */
  quickAnswers: string
  guides: string
  /** Row that opens the full guide list; `{n}` is the number of guides. */
  allGuides: string
  /** Header of the full guide list. */
  allGuidesTitle: string
  /** Guide reading time; `{n}` is minutes. */
  readTime: string
  /** Label of the card that returns to the stored conversation. */
  continueConversation: string
  /** First search result on the home screen; `{q}` is the typed text. */
  askQuery: string
  back: string
  /** Label above the links an answer came from. */
  sources: string
  /** Tag on an answer the visitor stopped. */
  stopped: string
  /** Link to `contactUrl`. */
  contact: string
  /** Thumbs-down follow-up question and its three reasons. */
  feedbackQuestion: string
  reasonWrong: string
  reasonOffTopic: string
  reasonOutdated: string
  feedbackThanks: string
  /** New-chat confirmation. */
  deleteConfirm: string
  deleteNote: string
  deleteYes: string
  deleteNo: string
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
  /** Home "Quick answers" (first three) and composer search. */
  quickReplies: QuickReply[]
  /** Home "Guides" (first three), the full guide list and composer search. */
  articles: Article[]
  /** Where "Contact the team" links go. Empty hides the link. */
  contactUrl: string
  linkPrefix?: LinkPrefix
  /** localStorage key for the conversation. */
  storageKey: string
  /** localStorage key for the per-message feedback map. */
  feedbackStorageKey: string
}
