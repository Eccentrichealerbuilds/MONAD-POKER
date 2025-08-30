 import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  base: '/poker',
  plugins: [react()],
  server: {
    port: 7000,
    host: true,
    allowedHosts: ['monadpoker.xyz', 'localhost:7000'],
    // Allow access from monadpoker.xyz domain
    cors: {
      origin: ['http://localhost:7000', 'https://monadpoker.xyz', 'http://monadpoker.xyz'],
      credentials: true
    },
    proxy: {
      '/api': {
        target: process.env.VITE_BACKEND_URL || 'http://localhost:4000',
        changeOrigin: true,
        secure: false,
      }
    }
  },
  preview: {
    port: 7000,
    host: true,
  }
})
