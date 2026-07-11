/**
 * Session-scoped "the panel is open" flag — reopen-after-navigation.
 *
 * Messenger widgets survive page navigation: the panel is torn down with the
 * page, but if it was open when the user left, the next page reopens it
 * (desktop only, instantly, without stealing focus) so the chat travels with
 * the user across the site. The flag lives in sessionStorage — per-tab and
 * gone when the tab closes, so the chat never pops open by itself days later.
 *
 * The key is derived from the instance's `storageKey`, so two widgets on the
 * same origin (e.g. the demo index and its embed iframes) never restore each
 * other's open state.
 *
 * Shared by panel.ts (writes on open/close) and the AIChat.astro shell script
 * (reads on page init) — a separate module so the shell doesn't pull panel.ts
 * into the initial bundle.
 */

export const openStateKey = (storageKey: string): string => `${storageKey}:open`

export function rememberOpen(key: string, open: boolean): void {
  try {
    if (open) sessionStorage.setItem(key, '1')
    else sessionStorage.removeItem(key)
  } catch {
    /* private mode / disabled storage — reopen-after-navigation just won't happen */
  }
}

export function wasOpen(key: string): boolean {
  try {
    return sessionStorage.getItem(key) === '1'
  } catch {
    return false
  }
}
