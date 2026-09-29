import { resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  plugins: [
    react(),
    {
      name: 'daily-planning-test-preview',
      apply: 'serve',
      configureServer(server) {
        server.middlewares.use('/__preview/daily-planning', async (request, response, next) => {
          if (new URL(request.url ?? '/', 'http://localhost').searchParams.get('testMode') !== 'planning')
            return next()
          try {
            const template = await readFile(
              resolve(__dirname, 'src/tests/daily-planning-preview.html'),
              'utf8',
            )
            const html = template
              .replace('../renderer/src/main.tsx', '/src/main.tsx')
              .replace(
                './daily-planning-preview.js',
                `/@fs/${resolve(__dirname, 'src/tests/daily-planning-preview.js')}`,
              )
            response.setHeader('Content-Type', 'text/html')
            response.end(await server.transformIndexHtml('/__preview/daily-planning', html))
          } catch (error) {
            next(error)
          }
        })
      },
    },
  ],
  server: { host: '127.0.0.1', port: 5175, strictPort: true },
})
