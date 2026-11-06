// Demo only. The npm package ships src/ without a build step.
import { defineConfig } from 'astro/config'

export default defineConfig({
  srcDir: './demo',
  output: 'static',
  site: 'https://eeegoloauq.github.io',
  base: process.env.ASTRO_BASE || '/astro-chat-widget',
  trailingSlash: 'always',
  server: { port: 4322, host: true },
  // The toolbar sits over the widget's composer and button on phones.
  devToolbar: { enabled: false },
})
