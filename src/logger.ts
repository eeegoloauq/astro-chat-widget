/**
 * Console wrapper: log/warn only in dev builds (Vite strips the branches in
 * production), errors always. Prefixed so widget output is attributable on
 * a host page.
 */

const DEV = typeof import.meta.env !== 'undefined' && !!import.meta.env.DEV

export const logger = {
  log(...args: unknown[]): void {
    if (DEV) console.log('[astro-chat-widget]', ...args)
  },
  warn(...args: unknown[]): void {
    if (DEV) console.warn('[astro-chat-widget]', ...args)
  },
  error(...args: unknown[]): void {
    console.error('[astro-chat-widget]', ...args)
  },
}
