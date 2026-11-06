# Roadmap

Larger work that shouldn't be done in passing. Remove an item when it ships.

- **Release the home screen as 0.1.3.** Merge `dev` into `main` after review, then tag `v0.1.3` with the upgrade notes from [docs/reference.md](./docs/reference.md#upgrading-from-012).
- **Add critical runtime coverage.** No automated tests exercise SSE consumption, streamed rendering, dialog state, or storage behavior in `src/transport.ts`, `src/render.ts`, `src/panel.ts`, and `src/store.ts`.
- **Resolve the unused icon.** `docs/icon.svg` has no tracked code reference while `demo/pages/index.astro` inlines a separate favicon SVG.
