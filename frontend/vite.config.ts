import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In Docker dev: BACKEND_URL=http://backend:8000 (set by docker-compose.dev.yml)
// Locally without Docker: falls back to localhost
const backendTarget = process.env.BACKEND_URL ?? 'http://localhost:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,   // allow connections from outside the container
    proxy: {
      '/api': {
        target: backendTarget,
        rewrite: (path) => path.replace(/^\/api/, ''),
        changeOrigin: true,
      },
    },
  },
})
