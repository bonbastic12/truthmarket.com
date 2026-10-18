import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Forwards /api calls to the Express server so the browser sees one origin (no CORS in development).
    proxy: { '/api': { target: 'http://localhost:5000', changeOrigin: true } },
  },
});
