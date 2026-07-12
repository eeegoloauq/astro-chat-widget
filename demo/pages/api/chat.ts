/**
 * Mock SSE backend for the demo playground. Implements the protocol from the
 * README: streams `{chunk}` events word by word, ends with `{done, suggestions}`.
 * Dev-only — the demo is never built.
 */
import type { APIRoute } from 'astro'

export const prerender = false

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
  text: [
    "Hi! I'm the **demo backend** — canned answers, streamed over real SSE so you can feel the widget exactly as it ships.",
    '',
    'Try asking about:',
    '',
    '- *theming* — the `--acw-*` token contract',
    '- *markdown* — what the streaming renderer handles',
    '- *the iOS keyboard* — the non-modal mobile sheet',
    '',
    'Or just watch the word-by-word reveal do its thing.',
  ].join('\n'),
  suggestions: ['How do I theme it?', 'Show markdown rendering', 'What about the iOS keyboard?'],
}

export const POST: APIRoute = async ({ request }) => {
  const { message = '' } = await request.json().catch(() => ({}))
  const answer = ANSWERS.find((a) => a.match.test(message)) ?? DEFAULT_ANSWER

  // Time-to-first-token, INSIDE the stream like a real LLM backend: headers
  // land immediately, the first chunk only after the model has "thought" —
  // the widget must keep its typing indicator through exactly that gap.
  // The index-showcase iframes (same-origin Referer carries the /embed query)
  // get choreography on top: the phone frame thinks a touch longer than the
  // desktop one, and the iOS question is the long-think beat on both — held
  // past the widget's 8s threshold so the typing label flips to "Taking a
  // bit longer than usual…" before the answer lands.
  const referer = request.headers.get('referer') || ''
  const showcase = referer.includes('/embed')
  const longThink = showcase && /ios|keyboard|клав/i.test(message)
  const firstTokenDelay = longThink ? 10500 : showcase && !referer.includes('desktop') ? 1800 : 700

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      await new Promise((r) => setTimeout(r, firstTokenDelay))
      // Keep trailing spaces attached so chunks concatenate cleanly.
      for (const word of answer.text.split(/(?<=\s)/)) {
        send({ chunk: word })
        await new Promise((r) => setTimeout(r, 24))
      }
      send({ done: true, suggestions: answer.suggestions })
      controller.close()
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
  })
}
