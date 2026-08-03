import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Proxies /api calls to the Node.js + MySQL backend during development,
// so the frontend can call relative paths like /api/regions without CORS setup.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
})
