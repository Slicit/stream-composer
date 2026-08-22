import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The dev server proxies /api straight to Rails so the browser only ever
// talks to one origin — the Vite dev server's own. That keeps the
// sc_session cookie simple (no cross-site SameSite/CORS story to solve for
// local dev at all): from the browser's point of view, Rails' responses
// are same-origin.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_RAILS_ORIGIN || 'http://localhost:13000',
        changeOrigin: true,
      },
    },
  },
})
