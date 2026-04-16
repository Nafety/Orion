import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  base: '/',   // essentiel pour que tous les assets soient relatifs à la racine
  plugins: [react(), cloudflare()],
})