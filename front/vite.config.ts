import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    // Vite rejette tout Host absent de cette liste (anti-DNS-rebinding) : sans
    // elle, les domaines *.orb.local d'OrbStack recoivent un 403.
    allowedHosts: ['.orb.local'],
    // Meme contrat qu'en prod : le front tape /api en same-origin, quel que soit
    // le nom par lequel on l'atteint (localhost, *.orb.local, IP du LAN).
    proxy: {
      '/api': {
        target: 'http://api:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
    watch: { usePolling: true, interval: 300 },
  },
})
