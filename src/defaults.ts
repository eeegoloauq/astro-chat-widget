import type { ChatStrings } from './types'

export const DEFAULT_STRINGS: ChatStrings = {
  title: 'AI assistant',
  buttonLabel: 'Open AI chat',
  placeholder: 'Ask a question…',
  disclaimer: 'AI answers may contain mistakes — please double-check important details.',
  greeting: 'Hi! How can I help you today?',
  thinking: 'Thinking…',
  thinkingLong: 'Taking a bit longer than usual…',
  retry: 'Retry',
  copy: 'Copy',
  copied: 'Copied',
  helpful: 'Helpful',
  notHelpful: 'Not helpful',
  serverUnavailable: 'The assistant is unavailable right now. Please try again.',
  rateLimit: 'Too many messages — you can continue in {s}s.',
  quickLabel: 'Suggested questions',
  send: 'Send',
  stop: 'Stop generating',
  newChat: 'New chat',
  close: 'Close',
  expand: 'Expand',
  collapse: 'Collapse',
}

export const DEFAULT_STORAGE_KEY = 'acw-conversation'
export const DEFAULT_FEEDBACK_STORAGE_KEY = 'acw-feedback'
export const DEFAULT_DEEP_LINK_HASH = '#chat'
