import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// In development the API runs separately (uvicorn on :8000); in Docker nginx
// proxies /api, and on Vercel the same path is routed to the Python function.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': process.env.VITE_API_PROXY ?? 'http://localhost:8000' },
  },
})
