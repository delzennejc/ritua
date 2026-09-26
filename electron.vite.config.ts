import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [react()],
    resolve: { alias: { '@renderer': resolve('src/renderer/src') } },
    server: {
      host: '127.0.0.1',
      port: Number(process.env.RITUA_RENDERER_PORT) || 5174,
      strictPort: true,
    },
  },
})
