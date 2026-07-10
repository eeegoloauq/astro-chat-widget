# CLAUDE.md

Operating guide for AI coding agents working in this repo (`AGENTS.md` is a symlink to this file for other tools). Humans: start with [README.md](./README.md).

## What this is

`astro-chat-widget` — a self-contained AI chat widget for Astro sites: FAB → native `<dialog>` panel → streaming SSE answers. Zero framework runtime, exactly one runtime dependency (`streaming-markdown`).

Two facts that shape everything:

- **The package ships as TypeScript source.** `src/` is published as-is (see `files` in package.json); the consumer's Astro/Vite compiles it. There is no build/dist step.
- **`demo/` is a dev-only playground** (mock SSE backend, two pages). It never ships.

## Commands

| Command | Purpose |
| --- | --- |
| `npm ci` | Install. Lockfile-only; `.npmrc` sets `ignore-scripts=true` — keep both. |
| `npm run check` | `astro check` over `src/` + `demo/`. **The static verification loop.** Must stay at 0 errors. |
| `npm run demo` | Dev server at `http://localhost:4322` against the mock SSE backend. |

There is **no test suite** and **no build step**. `astro build` fails by design (the demo's API routes are on-demand and no adapter is installed) — do not add an adapter or "fix" the build.

## How to verify a change

1. `npm run check` → 0 errors.
2. Runtime, headlessly: `npm run demo`, then drive `http://localhost:4322` with Playwright — open the FAB, send a message, watch the streamed markdown render, read the console for `[astro-chat-widget]` errors. The index frames `/embed` previews (desktop + `?accent=` rebrand) that exercise both panel modes and the theming tokens.
3. Anything touching the mobile keyboard, `visualViewport`, or touch scrolling **cannot be verified in desktop Chromium**. Real iOS device numbers are the only ground truth (`#kbdebug` URL hash shows a live overlay). If you changed that code, say explicitly in your report that it needs a real-device pass — do not claim it verified.

## Map

Entry flow: `AIChat.astro` renders static HTML → lazy-imports `controller.ts` on first interaction → controller wires everything else.

| File | One-liner |
| --- | --- |
| `src/index.ts` | Public exports: component, `DEFAULT_STRINGS`, public types. |
| `src/AIChat.astro` | Static shell (FAB + closed `<dialog>`); resolves props against defaults and serializes the full config into `data-acw-config`. |
| `src/controller.ts` | `createChat(root)` — wires panel/store/transport/render/ui; teardown is one `AbortController.abort()`. |
| `src/panel.ts` | Open/close: `showModal()` on desktop, **non-modal `show()` on mobile** + `visualViewport` tracking (the iOS keyboard fix). |
| `src/transport.ts` | POST + SSE consumption; wire protocol documented in README. |
| `src/render.ts` | Streaming markdown via `streaming-markdown`: append-only DOM, whole-word reveal at adaptive cadence. |
| `src/ui.ts` | DOM builders for bubbles, chips, notes, message actions — `createElement`/`textContent` only. |
| `src/scroll.ts` | Auto-scroll state machine; touch-grace rules tuned on real iOS. |
| `src/store.ts` | One conversation in localStorage + feedback map; degrades to in-memory on storage failure. |
| `src/defaults.ts` | `DEFAULT_STRINGS` — the English i18n baseline. |
| `src/types.ts` | Public configuration types. |
| `src/logger.ts` | Dev-only console wrapper, `[astro-chat-widget]`-prefixed. |
| `src/styles/` | `tokens.css` (the `--acw-*` theme surface), `panel.css`, `messages.css`. |
| `demo/pages/` | Playground pages + mock SSE backend (`api/chat.ts`, `api/feedback.ts`). |
| `astro.config.mjs` | Demo-only config (`srcDir: ./demo`, port 4322). |

Every module carries a header comment explaining the *why*, not just the what. Those headers are the primary architecture documentation — read them before editing a file, and update them in the same commit when behaviour changes.

## Invariants — deliberate decisions that look like bugs

Do not "fix", "simplify" or "modernise" these. If one truly must change, flag it as a design change, not a cleanup.

1. **Mobile opens the dialog non-modally** (`dialog.show()`, not `showModal()`). iOS Safari clips top-layer content to the visual viewport when the software keyboard is up (WebKit [#300965](https://bugs.webkit.org/show_bug.cgi?id=300965), [#303167](https://bugs.webkit.org/show_bug.cgi?id=303167)). The non-modal `position:fixed` sheet riding `visualViewport` is the fix, not an oversight.
2. **No `innerHTML` with interpolated data anywhere.** DOM is built with `createElement`/`createTextNode`; `<img>` in answers is stripped (a prompt-injected backend must not fire outbound requests); unsafe URL schemes are rejected; external links get `noopener`; HTTPS is enforced for endpoints in production builds. These are prompt-injection defenses.
3. **Rendering is append-only.** During streaming, DOM that has been emitted is never rewritten — that is what prevents formatting flicker. Don't introduce re-render-the-bubble approaches.
4. **`scroll.ts` touch-grace rules** were tuned against real iOS swipe inertia. Do not simplify them away.
5. **One conversation, one instance per page.** No multi-chat sidebar, no cross-tab sync — deliberate scope.
6. **The runtime module reads configuration only from `data-acw-config`.** No env vars, no direct prop access at runtime.
7. **Dependency policy: runtime deps = 1, and it stays that way.** A new dependency is a design decision, never part of a fix — prefer a few lines of own code. If one is truly added: `osv-scanner` before merge, avoid releases younger than ~a week, lockfile committed, `ignore-scripts` stays on.
8. **`src/` must remain valid untranspiled Astro/TS for consumers' toolchains** — no path aliases, no build-time-only syntax, nothing that assumes this repo's config.

## Conventions

- Public API surface = props, `ChatStrings` keys, `acw:*` CustomEvents, `--acw-*` CSS tokens, the SSE wire protocol, localStorage shapes. Changing any of these is breaking; additions must be mirrored in the README tables **in the same commit**.
- Everything visually themeable goes through an `--acw-*` custom property in `src/styles/tokens.css` — no hardcoded colors in the other stylesheets.
- User-facing text lives only in `DEFAULT_STRINGS` / `ChatStrings` — never hardcode copy in the runtime module.
- Commit style follows the existing history: `feat:`/`fix:`/`chore:` + imperative summary.
