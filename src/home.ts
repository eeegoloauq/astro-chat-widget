/**
 * Panel screens and the home screen.
 *
 * The panel holds three screens, one visible at a time: home (quick answers,
 * guides, continue card), chat (the conversation) and guides (every article).
 * The composer below them is shared, so "ask" sits in the same place on every
 * screen. Hidden screens are `inert`; the current one is `data-screen` on the
 * dialog, which the CSS reads. Switching is instant.
 *
 * Typing on home swaps the lists for search results: an "Ask …" row first,
 * then matching quick answers and guides. Enter still sends to the backend.
 *
 * Guide rows are real links: they navigate the host page, and the
 * reopen-after-navigation flag carries an open desktop panel along. The
 * remembered screen lets that restored panel land where it was left.
 */

import { isExternalUrl, isSafeUrl } from './links'
import { rememberScreen } from './openState'
import type { Screen } from './openState'
import type { Article, ChatStrings, QuickReply } from './types'

const HOME_ITEMS = 3
const MAX_REPLY_RESULTS = 3
const MAX_ARTICLE_RESULTS = 5

// Static icon markup only — never interpolated with data.
const ICONS = {
  question:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.3M12 17h.01"/></svg>',
  doc:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>',
  spark:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
    '<path d="M12 1c1 6.4 4.6 10 11 11-6.4 1-10 4.6-11 11-1-6.4-4.6-10-11-11 6.4-1 10-4.6 11-11z"/></svg>',
  chevron:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>',
}

export type GuideOrigin = 'home' | 'search' | 'guides'

export interface HomeHandlers {
  /** A quick answer was picked (from the list or the search results). */
  onReply(reply: QuickReply): void
  /** The "Ask …" search row was picked. */
  onAsk(): void
  /** A guide link was followed. The browser navigates on its own. */
  onGuide(href: string, from: GuideOrigin, external: boolean): void
}

export interface Home {
  current(): Screen
  go(screen: Screen, opts?: { focus?: boolean }): void
  /** Composer text changed; drives the home search. */
  onInput(text: string): void
  /** Latest user question for the continue card; null hides it. */
  setLastQuestion(text: string | null): void
  dispose(): void
}

const isMobile = () => window.matchMedia('(max-width: 768px)').matches

/** Lowercased words of any script, for a forgiving contains-match. */
const words = (text: string) =>
  text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1)

function score(queryWords: string[], haystack: string): number {
  const hay = haystack.toLowerCase()
  return queryWords.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0)
}

export function createHome(
  dialog: HTMLDialogElement,
  input: HTMLTextAreaElement,
  config: { strings: ChatStrings; quickReplies: QuickReply[]; articles: Article[] },
  handlers: HomeHandlers,
  openKey: string
): Home {
  const { strings, quickReplies } = config
  const articles = config.articles.filter((a) => a.title && isSafeUrl(a.href))
  const listeners = new AbortController()
  const { signal } = listeners

  const section = (name: Screen) => dialog.querySelector<HTMLElement>(`[data-acw-screen="${name}"]`)
  const defaults = dialog.querySelector<HTMLElement>('.acw-home-default')!
  const results = dialog.querySelector<HTMLElement>('.acw-results')!
  const resume = dialog.querySelector<HTMLButtonElement>('.acw-resume')!
  const resumeText = dialog.querySelector<HTMLElement>('.acw-resume-text')!

  // ── Rows ────────────────────────────────────────────────────────────────

  function row(
    tag: 'a' | 'button',
    icon: string,
    text: string,
    meta?: string | null,
    className = ''
  ): HTMLAnchorElement | HTMLButtonElement {
    const node = document.createElement(tag)
    node.className = `acw-row ${className}`.trim()
    if (node instanceof HTMLButtonElement) node.type = 'button'
    const iconBox = document.createElement('span')
    iconBox.className = 'acw-row-icon'
    iconBox.innerHTML = icon
    const label = document.createElement('span')
    label.className = 'acw-row-text'
    label.textContent = text
    node.append(iconBox, label)
    if (meta) {
      const m = document.createElement('span')
      m.className = 'acw-row-meta'
      m.textContent = meta
      node.appendChild(m)
    }
    return node
  }

  const replyRow = (reply: QuickReply) => {
    const node = row('button', ICONS.question, reply.text)
    node.addEventListener('click', () => handlers.onReply(reply), { signal })
    return node
  }

  const articleRow = (article: Article, from: GuideOrigin) => {
    const meta = article.minutes ? strings.readTime.replace('{n}', String(article.minutes)) : null
    const link = row('a', ICONS.doc, article.title, meta) as HTMLAnchorElement
    link.href = article.href
    const external = isExternalUrl(article.href, window.location.origin)
    if (external) {
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
    }
    link.addEventListener('click', () => handlers.onGuide(article.href, from, external), { signal })
    return link
  }

  function group(title: string | null, rows: HTMLElement[]): HTMLElement {
    const box = document.createElement('div')
    box.className = 'acw-group'
    if (title) {
      const h = document.createElement('h3')
      h.className = 'acw-group-title'
      h.textContent = title
      box.appendChild(h)
    }
    box.append(...rows)
    return box
  }

  // ── Static lists (built once) ───────────────────────────────────────────

  if (quickReplies.length) {
    defaults.appendChild(group(strings.quickAnswers, quickReplies.slice(0, HOME_ITEMS).map(replyRow)))
  }
  if (articles.length) {
    const rows: HTMLElement[] = articles.slice(0, HOME_ITEMS).map((a) => articleRow(a, 'home'))
    if (articles.length > HOME_ITEMS) {
      const more = row('button', ICONS.chevron, strings.allGuides.replace('{n}', String(articles.length)), null, 'acw-row--more')
      more.addEventListener('click', () => go('guides', { focus: true }), { signal })
      rows.push(more)
    }
    defaults.appendChild(group(strings.guides, rows))
    section('guides')?.querySelector('.acw-guides-list')?.appendChild(
      group(null, articles.map((a) => articleRow(a, 'guides')))
    )
  }

  resume.addEventListener('click', () => go('chat', { focus: true }), { signal })
  dialog.querySelectorAll<HTMLButtonElement>('.acw-back').forEach((button) =>
    button.addEventListener('click', () => go('home', { focus: true }), { signal })
  )

  // ── Navigation ──────────────────────────────────────────────────────────

  let screen: Screen = 'home'

  function go(next: Screen, opts: { focus?: boolean } = {}): void {
    if (next === 'guides' && articles.length <= HOME_ITEMS) next = 'home'
    screen = next
    dialog.dataset.screen = next
    for (const name of ['home', 'chat', 'guides'] as const) {
      const node = section(name)
      if (node) node.inert = name !== next
    }
    const placeholder = next === 'chat' ? strings.placeholderFollowUp : strings.placeholder
    input.placeholder = placeholder
    input.setAttribute('aria-label', placeholder)
    rememberScreen(openKey, next)
    onInput(input.value)
    if (!opts.focus || !dialog.open) return
    // The control that moved us is now inert, so focus has to land somewhere
    // deliberate. Phones get a header button: focusing the composer would pop
    // the keyboard.
    const header = section(next)?.querySelector<HTMLElement>('.acw-header button')
    // preventScroll: focusing must never scroll a clipped container.
    if (next === 'guides' || isMobile()) header?.focus({ preventScroll: true })
    else input.focus({ preventScroll: true })
  }

  // ── Search ──────────────────────────────────────────────────────────────

  function onInput(text: string): void {
    const query = screen === 'home' ? text.trim() : ''
    defaults.hidden = query !== ''
    results.hidden = query === ''
    results.textContent = ''
    if (!query) return

    const ask = row('button', ICONS.spark, strings.askQuery.replace('{q}', query), '↵', 'acw-row--ask')
    ask.addEventListener('click', () => handlers.onAsk(), { signal })

    const q = words(query)
    const replies = quickReplies
      .map((reply) => ({ reply, s: score(q, reply.text) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, MAX_REPLY_RESULTS)
      .map((x) => replyRow(x.reply))
    const guides = articles
      .map((article) => ({ article, s: score(q, `${article.title} ${article.keywords ?? ''}`) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, MAX_ARTICLE_RESULTS)
      .map((x) => articleRow(x.article, 'search'))
    results.appendChild(group(null, [ask, ...replies, ...guides]))
  }

  function setLastQuestion(text: string | null): void {
    resume.hidden = !text
    resumeText.textContent = text ?? ''
  }

  go('home')

  return {
    current: () => screen,
    go,
    onInput,
    setLastQuestion,
    dispose: () => listeners.abort(),
  }
}
