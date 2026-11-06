# Roadmap

Larger work that shouldn't be done in passing. Remove an item when it ships.

- **Add critical runtime coverage.** No automated tests exercise SSE consumption, streamed rendering, dialog state, or storage behavior in `src/transport.ts`, `src/render.ts`, `src/panel.ts`, and `src/store.ts`.
- **Resolve the unused icon.** `docs/icon.svg` has no tracked code reference while `demo/pages/index.astro` inlines a separate favicon SVG.
