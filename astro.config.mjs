// Dev config for the demo playground only (`npm run demo`).
// The published package is the `src/` sources; nothing here ships.
import { defineConfig } from 'astro/config'

export default defineConfig({
  srcDir: './demo',
  server: { port: 4322, host: true },
})
