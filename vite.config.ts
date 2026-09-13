import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [VitePWA({
    registerType: 'autoUpdate',
    injectRegister: 'auto',
    includeAssets: ['favicon.svg', 'connection-config.js'],
    manifest: {
      name: 'Scrabble — a friendly word room', short_name: 'Scrabble', description: 'A real-time 2–4 player Scrabble room.',
      theme_color: '#17231d', background_color: '#f5f6f2', display: 'standalone', start_url: './', scope: './',
      icons: [{ src: './favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
    },
    workbox: { globPatterns: ['**/*.{js,css,html,svg,png,ico,txt}'] },
  })],
  server: { watch: { ignored: ['**/work/**'] } },
});
