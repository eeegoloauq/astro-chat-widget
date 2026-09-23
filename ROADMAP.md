# Roadmap

Larger work that shouldn't be done in passing. Remove an item when it ships.

- **Share starter FAQ content.** The same showcase questions are maintained in `demo/pages/index.astro` and `demo/pages/embed.astro`.
- **Add critical runtime coverage.** No automated tests exercise SSE consumption, streamed rendering, dialog state, or storage behavior in `src/transport.ts`, `src/render.ts`, `src/panel.ts`, and `src/store.ts`.
- **Make the demo entry clear.** The framed previews in `demo/pages/index.astro` do not accept interaction; visitors must find the separate corner button to try the widget.
- **Resolve the unused icon.** `docs/icon.svg` has no tracked code reference while `demo/pages/index.astro` inlines a separate favicon SVG.
