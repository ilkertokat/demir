import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Göreli yollar: dosyayı herhangi bir klasöre/host'a koyunca da çalışsın
  base: './',
  build: { outDir: 'dist', assetsInlineLimit: 0 },
})
