import { defineConfig } from 'vite' 
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/callback': 'http://127.0.0.1:8080',
      '/login': 'http://127.0.0.1:8080',
      '/api': 'http://127.0.0.1:8080'
    },
    host: 'localhost',  // pour HMR
    port: 5173,
    hmr: {
      host: 'localhost',
      protocol: 'ws',
      port: 5173
    }
  }
})