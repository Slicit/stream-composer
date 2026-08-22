import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The dev server proxies /api straight to Rails so the browser only ever
// talks to one origin — the Vite dev server's own. That keeps the
// sc_session cookie simple (no cross-site SameSite/CORS story to solve for
// local dev at all): from the browser's point of view, Rails' and the Go
// data plane's responses are both same-origin.
//
// /api/state and /mtx belong to the Go data plane, not Rails — proxy keys
// are matched in insertion order, so the more specific /api/state entry
// must come before the general /api one or every request would go to
// Rails, which has no such route.
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
      '/api/state': {
        target: process.env.VITE_DATAPLANE_ORIGIN || 'http://localhost:18080',
        changeOrigin: true,
      },
      // A leading ^ makes this key a regex match rather than a plain
      // prefix — needed here because /api/channels/:slug/state and
      // /api/channels/mine both start with /api/channels/ but must go to
      // different origins (the data plane vs. Rails).
      '^/api/channels/[^/]+/state$': {
        target: process.env.VITE_DATAPLANE_ORIGIN || 'http://localhost:18080',
        changeOrigin: true,
      },
      '/mtx': {
        target: process.env.VITE_DATAPLANE_ORIGIN || 'http://localhost:18080',
        changeOrigin: true,
        ws: true,
      },
      '/api': {
        target: process.env.VITE_RAILS_ORIGIN || 'http://localhost:13000',
        changeOrigin: true,
      },
    },
  },
})
