/**
 * Panel behaviour around the native <dialog>.
 *
 * The dialog ALWAYS opens NON-modally (show(), never showModal()) — a chat
 * widget is a companion to the page, not a modal over it.
 *
 * DESKTOP: Intercom-style floating panel. The page behind stays scrollable
 * and interactive — the point of a site assistant is chatting WHILE browsing
 * (ask about the product you're looking at). So: no backdrop, no scroll lock,
 * no focus trap, and clicks on the page do NOT close the chat (users copy
 * page text into the composer). What showModal() used to give for free is
 * done by hand: Esc closes while focus is inside the panel, closing hands
 * focus back to the FAB, and stacking is an explicit z-index (--acw-z-panel)
 * instead of the top layer.
 *
 * MOBILE: non-modal is additionally the whole iOS fix: a showModal() dialog
 * lives in the top layer, and iOS Safari clips top-layer content (box +
 * ::backdrop) to the *visual* viewport when the software keyboard is up — so
 * the inert page bleeds through both above the header and below the composer,
 * no matter how opaque or full-height we make the sheet (WebKit #300965 /
 * #303167). Every production messenger (Telegram, WhatsApp, Intercom) avoids
 * top-layer for exactly this and ships a plain position:fixed sheet. So the
 * dialog is a normal fixed element (styles/panel.css), and we size the
 * keyboard band ourselves.
 *
 * Open state is remembered per tab (sessionStorage via openState.ts): the
 * shell reopens the panel after a same-tab navigation (see AIChat.astro), so
 * the chat travels with the user across pages.
 *
 * Open/close animation is pure CSS (@starting-style + allow-discrete).
 *
 * What's left for JS:
 *   - Esc → close while focus is inside the panel (non-modal dialogs have no
 *     built-in cancel behaviour), focus back to the FAB on close
 *   - textarea autosize + Enter-to-send (desktop)
 *   - iOS keyboard (mobile): track the visual viewport — RIDE the keyboard, don't
 *     fight it. Every visualViewport frame we set `--acw-vvh` = vv.height
 *     (panel.css makes that the panel height, so its bottom == the keyboard top
 *     and the composer, a bottom flex child, parks on the keyboard) and
 *     `--acw-vvtop` = vv.offsetTop (translateY on the panel + scrim, so they stay
 *     glued to the visible band as iOS focus-scrolls). No scrollTo, no padding
 *     math — those crutches fight each other and cause scroll bounces. Tradeoff
 *     (deliberate, same as Telegram/WhatsApp): the header rides the visible top
 *     rather than the physical screen top — on iOS Safari you get smooth OR
 *     header-nailed-to-top, not both. iOS gives no declarative keyboard signal
 *     (ignores interactive-widget, no VirtualKeyboard API), so visualViewport is
 *     the only tool; expect a ≤1-frame settle at the tail of the keyboard
 *     animation — the opaque panel/scrim mask it.
 */

import { rememberOpen } from './openState'

const MAX_INPUT_HEIGHT = 160

const isMobile = () => window.matchMedia('(max-width: 768px)').matches

export interface OpenOptions {
  /** Reopening after a page navigation: no entry animation, no focus steal. */
  restore?: boolean
}

export interface Panel {
  open(opts?: OpenOptions): void
  close(): void
  isOpen(): boolean
  dispose(): void
}

export function createPanel(
  dialog: HTMLDialogElement,
  input: HTMLTextAreaElement,
  callbacks: { onOpen(restored: boolean): void; onSubmit(): void },
  openKey: string
): Panel {
  const fab = dialog.closest('.acw-root')?.querySelector<HTMLElement>('.acw-fab') ?? null

  // Non-modal dialogs get no built-in Esc-to-close; only fires while focus is
  // inside the panel — Esc elsewhere belongs to the page.
  const onDialogKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !e.isComposing) dialog.close()
  }

  const autosize = () => {
    input.style.height = 'auto'
    input.style.height = `${Math.min(input.scrollHeight, MAX_INPUT_HEIGHT)}px`
  }

  const onKeydown = (e: KeyboardEvent) => {
    // Desktop: Enter sends, Shift+Enter = newline. Mobile keyboards keep
    // Enter as newline — the send button is the affordance there.
    // isComposing: an IME (CJK input) confirming a candidate is not a send.
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !isMobile()) {
      e.preventDefault()
      callbacks.onSubmit()
    }
  }

  // ── iOS keyboard: track the visual viewport + scroll-lock (mobile) ──────────
  // Every visualViewport frame we size the fixed panel to the visible band
  // (--acw-vvh) and translate it to the viewport offset (--acw-vvtop) — RIDE
  // iOS's focus-scroll, don't fight it. The scrim reads the same --acw-vvtop.
  const viewport = window.visualViewport
  const root = document.documentElement
  let vpRaf = 0

  // Scroll-lock. When the chat opens with the page scrolled far down, iOS
  // mis-anchors the fixed panel/scrim and bares the page top+bottom.
  // overflow:hidden freezes but does NOT reset that offset, so we shift
  // <body> up by scrollY and fix it → document scroll becomes 0 and the fixed
  // elements land on the viewport. (Fixed-body locks are usually discouraged
  // because they can start a scroll FIGHT with the browser — that fight only
  // happens when something else also scrolls programmatically; nothing here does.)
  let lockedScrollY = 0
  const lockScroll = () => {
    if (!isMobile()) return
    lockedScrollY = window.scrollY
    document.body.style.top = `-${lockedScrollY}px`
    document.body.classList.add('acw-scroll-locked')
  }
  const unlockScroll = () => {
    if (!document.body.classList.contains('acw-scroll-locked')) return
    document.body.classList.remove('acw-scroll-locked')
    document.body.style.top = ''
    window.scrollTo(0, lockedScrollY)
  }

  // Opt-in on-device readout — append #kbdebug to the URL. Desktop DevTools
  // can't reproduce the iOS keyboard, so real-device numbers are the only
  // ground truth.
  const debugOn = window.location.hash.includes('kbdebug') || window.location.search.includes('kbdebug')
  let dbg: HTMLElement | null = null
  const renderDebug = () => {
    if (!debugOn || !isMobile()) return
    if (!dbg) {
      dbg = document.createElement('div')
      dbg.style.cssText =
        'position:absolute;top:0;left:0;right:0;z-index:99;background:rgba(200,0,0,.92);' +
        'color:#fff;font:11px/1.3 monospace;padding:3px 6px;white-space:pre;pointer-events:none'
      dialog.appendChild(dbg)
    }
    const v = viewport
    const hdr = dialog.querySelector('.acw-header')?.getBoundingClientRect()
    dbg.textContent =
      `iH:${window.innerHeight} vvH:${v ? Math.round(v.height) : '-'} offY:${v ? Math.round(v.offsetTop) : '-'} scrY:${Math.round(window.scrollY)}\n` +
      `vvh:${root.style.getPropertyValue('--acw-vvh') || '-'} vvtop:${root.style.getPropertyValue('--acw-vvtop') || '0'} hdrTop:${hdr ? Math.round(hdr.top) : '-'}`
  }

  const clearProps = () => {
    root.style.removeProperty('--acw-vvh')
    root.style.removeProperty('--acw-vvtop')
  }

  const syncViewport = () => {
    vpRaf = 0
    if (!viewport || !isMobile() || !dialog.open) return clearProps()
    root.style.setProperty('--acw-vvh', `${Math.round(viewport.height)}px`)
    root.style.setProperty('--acw-vvtop', `${Math.round(viewport.offsetTop)}px`)
    renderDebug()
  }

  // resize (height) + scroll (offset) fire in a burst during the keyboard
  // animation — coalesce with rAF; both are needed. Blur re-syncs for builds that
  // skip the final resize on dismiss; the delayed re-check catches iOS 26, where
  // vv.height can linger ~24px short of full for a moment after the keyboard closes.
  const onViewportChange = () => {
    if (!vpRaf) vpRaf = requestAnimationFrame(syncViewport)
  }
  let settleTimer = 0
  const onInputBlur = () => {
    onViewportChange()
    clearTimeout(settleTimer)
    settleTimer = window.setTimeout(syncViewport, 300)
  }

  const onDialogClose = () => {
    clearProps()
    unlockScroll()
    rememberOpen(openKey, false)
    // showModal() used to restore focus on close for free; a non-modal close
    // drops it on <body> (the focused element just went display:none). Hand it
    // to the FAB — unless the user is already focused somewhere in the page.
    const active = document.activeElement
    if (!active || active === document.body || dialog.contains(active)) {
      fab?.focus()
    }
  }

  dialog.addEventListener('keydown', onDialogKeydown)
  dialog.addEventListener('close', onDialogClose)
  input.addEventListener('input', autosize)
  input.addEventListener('keydown', onKeydown)
  input.addEventListener('blur', onInputBlur)
  viewport?.addEventListener('resize', onViewportChange)
  viewport?.addEventListener('scroll', onViewportChange)

  return {
    open(opts) {
      if (dialog.open) return
      const restore = opts?.restore ?? false
      if (isMobile()) {
        lockScroll() // reset document scroll to 0 so the fixed panel/scrim land on the viewport
      } else if (restore) {
        // Reopening after a navigation must be instant — an entry animation on
        // every page load would break the "chat travels with you" illusion.
        dialog.classList.add('acw-no-anim')
        requestAnimationFrame(() =>
          requestAnimationFrame(() => dialog.classList.remove('acw-no-anim'))
        )
      }
      dialog.show() // ALWAYS non-modal — see the header comment
      rememberOpen(openKey, true)
      syncViewport() // seed --acw-vvh/--acw-vvtop for the current (keyboard-closed) state
      renderDebug()
      // No focus steal on mobile (surprise keyboard pop) or on restore (the
      // user is browsing the page; the chat is a companion, not a claim).
      // show() itself has already run the dialog focusing steps (the spec
      // offers no opt-out) and parked focus on the panel's first header
      // button — where a stray Enter would silently toggle it. Undo that:
      // either claim focus deliberately (composer) or give it back.
      if (!isMobile() && !restore) {
        input.focus()
      } else {
        const stolen = document.activeElement
        if (stolen instanceof HTMLElement && dialog.contains(stolen)) stolen.blur()
      }
      callbacks.onOpen(restore)
    },
    close() {
      dialog.close()
    },
    isOpen: () => dialog.open,
    dispose() {
      // Listeners go first: the dialog.close() below must NOT run
      // onDialogClose — dispose() fires on astro:before-swap, and erasing the
      // session open flag there would kill reopen-after-navigation.
      dialog.removeEventListener('keydown', onDialogKeydown)
      dialog.removeEventListener('close', onDialogClose)
      input.removeEventListener('input', autosize)
      input.removeEventListener('keydown', onKeydown)
      input.removeEventListener('blur', onInputBlur)
      viewport?.removeEventListener('resize', onViewportChange)
      viewport?.removeEventListener('scroll', onViewportChange)
      clearTimeout(settleTimer)
      if (vpRaf) cancelAnimationFrame(vpRaf)
      if (dialog.open) dialog.close()
      unlockScroll() // safety: never leave <body> fixed if disposed mid-open
    },
  }
}

/** Reset the textarea after send (autosize back to one row). */
export function resetInput(input: HTMLTextAreaElement): void {
  input.value = ''
  input.style.height = 'auto'
}
