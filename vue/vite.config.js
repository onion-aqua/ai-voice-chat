import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const backend = process.env.VITE_BACKEND_URL || 'http://127.0.0.1:8765'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: backend, changeOrigin: true },
      '/media': { target: backend, changeOrigin: true },
      '/generated-images': { target: backend, changeOrigin: true },
      '/computer-screenshots': { target: backend, changeOrigin: true },
      '/live2dmodels': { target: backend, changeOrigin: true },
    },
    fs: {
      deny: ['**/.env', '**/.env.*', '**/config.txt'],
    },
  },
})
