import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api/auth': {
        target: 'http://localhost:9001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/auth/, ''),
      },
      '/api/payment': {
        target: 'http://localhost:9002',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/payment/, ''),
      },
      '/api/bonus': {
        target: 'http://localhost:9003',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/bonus/, ''),
      },
      '/api/notification': {
        target: 'http://localhost:9004',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/notification/, ''),
      },
    },
  },
})
