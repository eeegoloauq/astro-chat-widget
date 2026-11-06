import { CHAT_ENDPOINT, FEEDBACK_ENDPOINT } from './endpoints'

// Browser-only demo transport. The published component keeps its real fetch transport.
const README = 'https://github.com/eeegoloauq/astro-chat-widget#'

interface Answer {
  match?: RegExp
  text: string
  suggestions: string[]
  sources?: { title: string; href: string }[]
  handoff?: boolean
}

const ANSWERS: Answer[] = [
  {
    match: /theme|color|css|token|красн/i,
    text: [
      'Theming is one CSS variable: every accent shade derives from `--acw-accent` via `color-mix()`.',
      '',
      '```css',
      ':root {',
      '  --acw-accent: #e31e24;',
      '}',
      '```',
      '',
      'Pick red under **Make it yours** on this page to see it. Surfaces, borders, text, radii and motion have their own tokens too.',
    ].join('\n'),
    suggestions: ['Show markdown rendering', 'What about the iOS keyboard?'],
    sources: [{ title: 'Theming', href: `${README}theming` }],
  },
  {
    match: /markdown|render|code/i,
    text: [
      'The renderer is **append-only** (`streaming-markdown`): once a character is on screen, its parent chain never changes, so formatting cannot flicker mid-stream.',
      '',
      '- Lists, **bold**, *italics*, `inline code`',
      '- [Links](https://example.com) get `target=_blank` + `noopener`',
      '- Images from answers are stripped — a prompt-injected backend must not fire outbound requests',
      '',
      '```ts',
      "const words = 'released whole, never half-built'",
      '```',
      '',
      '> Blockquotes and horizontal rules work too.',
    ].join('\n'),
    suggestions: ['How do I theme it?', 'What about the iOS keyboard?'],
    sources: [{ title: 'What it does', href: `${README}what-it-does` }],
  },
  {
    match: /ios|keyboard|mobile|клав/i,
    text: [
      'On mobile the dialog opens **non-modally** — a plain `position:fixed` sheet, not the top layer. iOS Safari clips top-layer content to the visual viewport under the software keyboard (WebKit #300965 / #303167), so `showModal()` there is unfixable by CSS.',
      '',
      'Instead the sheet *rides* the keyboard: every `visualViewport` frame sets `--acw-vvh` and `--acw-vvtop`, the composer parks on the keyboard top, and an oversized opaque scrim masks the ≤1-frame settle. Append `#kbdebug` to the URL on a real device for a live readout.',
    ].join('\n'),
    suggestions: ['How do I theme it?', 'Show markdown rendering'],
    sources: [{ title: 'Host page requirements', href: `${README}host-page-requirements` }],
  },
]

// An unmatched question: the backend asks the widget to offer the contact link.
const DEFAULT_ANSWER: Answer = {
  text: 'This demo uses preset responses. Ask about theming, Markdown or mobile layout. For AI answers, connect your own backend.',
  suggestions: ['How do I theme it?', 'Show markdown rendering', 'What about the iOS keyboard?'],
  handoff: true,
}


const originalFetch = window.fetch.bind(window)

window.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href)
  const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
  if (method.toUpperCase() !== 'POST' || ![CHAT_ENDPOINT, FEEDBACK_ENDPOINT].includes(url.href)) {
    return originalFetch(input, init)
  }
  if (url.href === FEEDBACK_ENDPOINT) return Response.json({ ok: true })
  const request = new Request(url, init)
  const { message = '' } = await request.json()
  const answer = ANSWERS.find((item) => item.match?.test(String(message))) ?? DEFAULT_ANSWER
  const firstDelay = 700
  const words = answer.text.split(/(?<=\s)/)
  const encoder = new TextEncoder()
  let index = 0
  let cancelled = false
  return new Response(new ReadableStream({
    async pull(controller) {
      await new Promise((resolve) => setTimeout(resolve, index === 0 ? firstDelay : 24))
      if (cancelled) return
      if (request.signal.aborted) {
        controller.error(new DOMException('Aborted', 'AbortError'))
        return
      }
      const event = index < words.length ? { chunk: words[index++] }
        : { done: true, suggestions: answer.suggestions, sources: answer.sources, handoff: answer.handoff }
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      if ('done' in event) controller.close()
    },
    cancel() { cancelled = true },
  }), { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } })
}
