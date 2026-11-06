// Demo content: quick answers, guides and strings for the widget on the demo page.
import type { Article, ChatStrings, QuickReply } from '../src/types'

const README = 'https://github.com/eeegoloauq/astro-chat-widget#'

export const STRINGS: Partial<ChatStrings> = {
  title: 'Widget demo',
  disclaimer: 'Preset responses. Messages stay in your browser.',
}

export const CONTACT_URL = 'https://github.com/eeegoloauq/astro-chat-widget/issues'

export const QUICK_REPLIES: QuickReply[] = [
  {
    text: 'What can this widget do?',
    answer: [
      'Everything on this page ships as **one Astro component**:',
      '',
      '- Streaming answers over SSE, markdown rendered append-only',
      '- Native `<dialog>`: a floating panel on desktop (the page stays scrollable), an iOS-keyboard-proof sheet on mobile',
      '- A home screen with quick answers and guides',
      '- Quick answers like this one arrive **instantly, without a backend call**',
      '',
      'Zero framework runtime, one dependency.',
    ].join('\n'),
    followUps: [
      {
        text: 'Does it need a backend?',
        answer: [
          'For AI answers, yes: any endpoint speaking the small SSE protocol from the README (`{chunk}` events, then `{done}`).',
          '',
          'Quick answers with a canned `answer`, like this one, render locally. A pure FAQ needs **no backend at all**.',
        ].join('\n'),
        followUps: [{ text: 'How do I theme it?' }],
      },
      { text: 'Show markdown rendering' },
    ],
  },
  { text: 'How do I theme it?' },
  { text: 'What about the iOS keyboard?' },
]

export const ARTICLES: Article[] = [
  { title: 'Quick start', href: `${README}quick-start`, minutes: 2, keywords: 'install npm setup start' },
  { title: 'Theming', href: `${README}theming`, minutes: 3, keywords: 'theme color colour accent css token dark light glass' },
  { title: 'Backend protocol', href: `${README}backend-protocol`, minutes: 3, keywords: 'sse backend api stream endpoint server sources' },
  { title: 'Props', href: `${README}props`, minutes: 3, keywords: 'options config strings quick replies articles contact' },
  { title: 'Opening the chat', href: `${README}opening-the-chat`, minutes: 1, keywords: 'button open link hash event shortcut' },
  { title: 'Analytics events', href: `${README}analytics-events`, minutes: 1, keywords: 'analytics events tracking goal' },
  { title: 'Host page requirements', href: `${README}host-page-requirements`, minutes: 2, keywords: 'mobile android ios keyboard viewport meta browser' },
]
