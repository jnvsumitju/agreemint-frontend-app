import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const API_URL = process.env.VITE_API_BASE_URL || 'http://localhost:8080'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: API_URL,
        changeOrigin: true,
      },
      '/ws': {
        target: API_URL.replace(/^http/, 'ws'),
        ws: true,
      },
    },
  },
})
