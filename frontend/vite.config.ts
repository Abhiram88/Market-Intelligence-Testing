import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 8082,
    proxy: {
      '/api/breeze': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/breeze/, ''),
      },
      '/api': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true,
      }
    }
  }
})