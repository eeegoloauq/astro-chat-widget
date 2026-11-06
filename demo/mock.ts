import { CHAT_ENDPOINT, FEEDBACK_ENDPOINT } from './endpoints'

// Browser-only demo transport. The published component keeps its real fetch transport.
const ANSWERS: { match: RegExp; text: string; suggestions: string[] }[] = [
  {
    match: /theme|color|css|token|красн/i,
    text: [
      'Theming is one CSS variable away — every color derives from `--acw-accent` via `color-mix()`:',
      '',
      '```css',
      ':root {',
      '  --acw-accent: #e31e24;',
      '}',
      '```',
      '',
      'The red phone frame on this page runs exactly this override. The full token table is in the README — surfaces, borders, text hierarchy, radii and motion are all overridable independently.',
    ].join('\n'),
    suggestions: ['Show markdown rendering', 'What about the iOS keyboard?'],
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
  },
  {
    match: /ios|keyboard|mobile|клав/i,
    text: [
      'On mobile the dialog opens **non-modally** — a plain `position:fixed` sheet, not the top layer. iOS Safari clips top-layer content to the visual viewport under the software keyboard (WebKit #300965 / #303167), so `showModal()` there is unfixable by CSS.',
      '',
      'Instead the sheet *rides* the keyboard: every `visualViewport` frame sets `--acw-vvh` and `--acw-vvtop`, the composer parks on the keyboard top, and an oversized opaque scrim masks the ≤1-frame settle. Append `#kbdebug` to the URL on a real device for a live readout.',
    ].join('\n'),
    suggestions: ['How do I theme it?', 'Show markdown rendering'],
  },
]

const DEFAULT_ANSWER = {
  text: 'This demo uses preset responses. Ask about theming, Markdown or mobile layout. For AI answers, connect your own backend.',
  suggestions: ['How do I theme it?', 'Show markdown rendering', 'What about the iOS keyboard?'],
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
  const answer = ANSWERS.find((item) => item.match.test(String(message))) ?? DEFAULT_ANSWER
  const showcase = location.pathname.includes('/embed')
  const firstDelay = showcase && /ios|keyboard|клав/i.test(message) ? 10500
    : showcase && !new URLSearchParams(location.search).has('desktop') ? 1800 : 700
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
        : { done: true, suggestions: answer.suggestions }
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      if ('done' in event) controller.close()
    },
    cancel() { cancelled = true },
  }), { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } })
}
