/**
 * Panel behaviour around the native <dialog>.
 *
 * DESKTOP opens the dialog with showModal() — the modal top layer gives us,
 * for free, what a hand-rolled overlay needs: no z-index ladder, Esc-to-close,
 * focus containment, ::backdrop, inert page behind. There's no keyboard there.
 *
 * MOBILE opens it with show() (NON-modal) instead. This is the whole iOS fix:
 * a showModal() dialog lives in the top layer, and iOS Safari clips top-layer
 * content (box + ::backdrop) to the *visual* viewport when the software
 * keyboard is up — so the inert page bleeds through both above the header and
 * below the composer, no matter how opaque or full-height we make the sheet
 * (WebKit #300965 / #303167). Every production messenger (Telegram, WhatsApp,
 * Intercom) avoids top-layer for exactly this and ships a plain position:fixed
 * sheet. So on mobile the dialog is a normal fixed element (styles/panel.css),
 * and we size the keyboard band ourselves.
 *
 * Open/close animation is pure CSS (@starting-style + allow-discrete) for both.
 *
 * What's left for JS:
 *   - backdrop click → close (desktop; click target === dialog means outside)
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

const MAX_INPUT_HEIGHT = 160

const isMobile = () => window.matchMedia('(max-width: 768px)').matches

export interface Panel {
  open(): void
  close(): void
  isOpen(): boolean
  dispose(): void
}

export function createPanel(
  dialog: HTMLDialogElement,
  input: HTMLTextAreaElement,
  callbacks: { onOpen(): void; onSubmit(): void }
): Panel {
  const onBackdropClick = (e: MouseEvent) => {
    if (e.target === dialog) dialog.close()
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
  }

  dialog.addEventListener('click', onBackdropClick)
  dialog.addEventListener('close', onDialogClose)
  input.addEventListener('input', autosize)
  input.addEventListener('keydown', onKeydown)
  input.addEventListener('blur', onInputBlur)
  viewport?.addEventListener('resize', onViewportChange)
  viewport?.addEventListener('scroll', onViewportChange)

  return {
    open() {
      if (dialog.open) return
      // Mobile: NON-modal → plain fixed sheet, no top layer (iOS clips top-layer
      // under the keyboard). Desktop: modal → top layer + Esc + focus-trap +
      // ::backdrop for free (no keyboard to fight there).
      if (isMobile()) {
        lockScroll() // reset document scroll to 0 so the fixed panel/scrim land on the viewport
        dialog.show()
      } else {
        dialog.showModal()
      }
      syncViewport() // seed --acw-vvh/--acw-vvtop for the current (keyboard-closed) state
      renderDebug()
      if (!isMobile()) input.focus() // no surprise keyboard pop on mobile
      callbacks.onOpen()
    },
    close() {
      dialog.close()
    },
    isOpen: () => dialog.open,
    dispose() {
      dialog.removeEventListener('click', onBackdropClick)
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
