/**
 * Link hardening shared by the markdown renderer, backend sources and the
 * shell's guide list. Kept free of DOM and streaming-markdown imports so the
 * Astro frontmatter can use it at build time.
 */

import type { LinkPrefix } from './types'

export function isSafeUrl(url: string): boolean {
  const trimmed = url.trim().toLowerCase()
  if (trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../')) return true
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return true
  // javascript:, data:, vbscript:, everything else
  return false
}

/** `/catalog/x` → `/en/catalog/x` for i18n hosts (see LinkPrefix). */
export function applyLinkPrefix(url: string, prefix?: LinkPrefix): string {
  const trimmed = url.trim()
  if (!prefix?.add || !trimmed.startsWith('/')) return trimmed
  const skip = prefix.skip?.length ? prefix.skip : [prefix.add]
  for (const s of skip) {
    if (trimmed === s || trimmed.startsWith(s.endsWith('/') ? s : `${s}/`)) return trimmed
  }
  return `${prefix.add}${trimmed}`
}

/** Absolute http(s) URL on another origin → open in a new tab. */
export function isExternalUrl(url: string, origin: string): boolean {
  const trimmed = url.trim()
  if (!/^https?:\/\//i.test(trimmed)) return false
  try {
    return new URL(trimmed).origin !== origin
  } catch {
    return false
  }
}

/** `contactUrl` may also be a mailto: address. */
export function isSafeContactUrl(url: string): boolean {
  return isSafeUrl(url) || /^mailto:[^\s]+$/i.test(url.trim())
}
