import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Serves the Vercel function in api/chat.js during `npm run dev`,
// so the free-tier proxy works locally without the Vercel CLI.
function apiDevServer() {
  return {
    name: 'api-dev-server',
    configureServer(server) {
      server.middlewares.use('/api/chat', async (req, res) => {
        try {
          const chunks = []
          for await (const chunk of req) chunks.push(chunk)
          req.body = chunks.length ? Buffer.concat(chunks).toString('utf8') : undefined
          const { default: handler } = await server.ssrLoadModule('/api/chat.js')
          await handler(req, res)
        } catch (err) {
          console.error(err)
          if (!res.headersSent) res.statusCode = 500
          res.end()
        }
      })
    }
  }
}

export default defineConfig(({ mode }) => {
  for (const [key, value] of Object.entries(loadEnv(mode, process.cwd(), ''))) {
    process.env[key] ??= value
  }

  return {
    plugins: [react(), apiDevServer()],
    optimizeDeps: {
      include: ['pdfjs-dist'],
      // onnxruntime-web resolves its .wasm files relative to its own module; keep it unbundled.
      exclude: ['@huggingface/transformers']
    },
    worker: {
      format: 'es'
    }
  }
})
