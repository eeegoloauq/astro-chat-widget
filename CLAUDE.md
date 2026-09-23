# Agent guide

`astro-chat-widget` is an Astro chat component for content sites with an existing AI or support backend. It opens a native dialog and streams SSE answers. The npm package ships `src/` as TypeScript and CSS source; consumers compile it. `demo/` is a playground and is not published. See [README.md](./README.md) for the public API and [demo screenshots](./docs/demo.webp) and [theme screenshot](./docs/theming.webp) for the intended appearance.

## Commands and release

- `npm ci` installs from the lockfile; `.npmrc` disables install scripts.
- `npm run check` runs `astro check` across the package and demo.
- `npm run build` builds the Vercel demo. Both CI workflows run it after `npm run check`; it creates no npm package artifact.
- `npm run demo` starts the mock backend and playground at `http://localhost:4322`.

There is no automated runtime test suite. For behavior changes, use the demo to open the widget, send a message, inspect streamed markdown, and check the browser console. Desktop emulation cannot validate iOS keyboard or touch scrolling: use a real iOS device and `#kbdebug` for viewport numbers.

The demo has a Vercel adapter, but this repo specifies no deployment trigger or rollback procedure. Before deploying it, identify the deployment and rollback mechanism in the hosting project; verify the demo after deployment and restore its previous deployment if needed. GitHub's publish workflow runs on `v*` tags or manual dispatch and publishes to npm after `npm run check`. A bad npm release requires a corrected version; the repo has no package rollback workflow.

## Decisions to preserve

- Keep the dialog non-modal (`show()`). It lets desktop visitors keep browsing and avoids Safari keyboard clipping of top-layer content on mobile. The mobile sheet follows `visualViewport`; touch-grace rules in `scroll.ts` were tuned on real iOS devices — don't simplify them.
- Streamed markdown is append-only to avoid formatting flicker. Do not replace emitted DOM during streaming.
- Build answer content with DOM nodes, never interpolated `innerHTML`. Reject unsafe links and answer images so backend content cannot trigger outbound requests. Keep production endpoints HTTPS.
- Keep one conversation and one widget instance per page. Runtime configuration comes from `data-acw-config`. User-facing text lives only in `DEFAULT_STRINGS`/`ChatStrings`. `src/` must work in consumers' Astro toolchains without this repo's build configuration.
- Keep the sole runtime dependency, `streaming-markdown`, unless a deliberate design change is agreed. Public props, strings, events, CSS tokens, SSE protocol, and storage shapes are compatibility surfaces; update README tables when they change.

Planned larger work: `ROADMAP.md`.
