# Demo hosting

The demo is static. `demo/mock.ts` streams preset answers in the browser; no model keys or server are needed. The npm component still uses its configured HTTP backend.

GitHub Pages uses `.github/workflows/pages.yml`. Select GitHub Actions as the Pages source. Main pushes run the type check and build with `ASTRO_BASE=/astro-chat-widget` before publishing `dist/`.

Before publishing, serve that build with `npm run demo -- --port 4322` at `/astro-chat-widget/` for development, or `npm exec astro preview -- --host 0.0.0.0 --port 4322` for the built files. Check `/astro-chat-widget/` at desktop and phone width: the panel, the "Make it yours" controls, a typed question, feedback and a new conversation. Check browser errors and failed requests.

After deployment, repeat those checks at the Pages URL. Keep the existing demo host until they pass. To roll back, revert the deployment commit and rerun the Pages workflow; the existing host remains available during migration.

The browser mock intercepts only POST requests to the reserved `https://demo.invalid/api/chat` and `/api/feedback` URLs. The HTTPS scheme preserves the component's production endpoint validation when previewing over HTTP on a LAN address. No chat request leaves the browser. Unmatched questions get a short explanation and suggested topics.
