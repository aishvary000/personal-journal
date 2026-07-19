import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server:{
    proxy: {
      '/api/login': 'http://localhost:3000',
      '/api/logout': 'http://localhost:3000',
      '/api/upload-file': 'http://localhost:3000',
      '/api/me': 'http://localhost:3000',
      '/api/health': 'http://localhost:3000'
    }
  }
})
