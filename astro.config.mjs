// Dev config for the demo playground only (`npm run demo`).
// The published package is the `src/` sources; nothing here ships.
import { defineConfig } from 'astro/config'
// Only for deploying the demo to Vercel (`npm run build`) — the demo's mock
// SSE endpoints are on-demand routes and need a server target. The published
// package itself still has no build step.
import vercel from '@astrojs/vercel'

export default defineConfig({
  srcDir: './demo',
  server: { port: 4322, host: true },
  adapter: vercel(),
})
