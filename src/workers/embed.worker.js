// Runs the multilingual embedding model off the main thread.
// Messages in:  { type: 'embed', id, kind: 'query' | 'passage', texts: string[] }
// Messages out: { type: 'progress', progress } | { type: 'ready' } | { type: 'result', id, vectors }
//               | { type: 'error', id?, message }

import { env, pipeline } from '@huggingface/transformers'
import { EMBED_MODEL } from '../lib/config.js'

env.allowLocalModels = false

const queue = []
let running = false

const loading = pipeline('feature-extraction', EMBED_MODEL, {
  dtype: 'q8',
  device: 'wasm',
  progress_callback: info => {
    if (info.status === 'progress_total') self.postMessage({ type: 'progress', progress: info.progress })
  }
}).then(extractor => {
  self.postMessage({ type: 'ready' })
  return extractor
}, err => {
  self.postMessage({ type: 'error', message: `Could not load the semantic search model: ${err.message}` })
  throw err
})
loading.catch(() => {}) // reported above; queued tasks are rejected in pump()

// e5 models expect "query: " / "passage: " prefixes.
async function embed(extractor, { kind, texts }) {
  const prefix = kind === 'query' ? 'query: ' : 'passage: '
  const output = await extractor(texts.map(t => prefix + t), { pooling: 'mean', normalize: true })
  const [count, dim] = output.dims
  return Array.from({ length: count }, (_, i) => output.data.slice(i * dim, (i + 1) * dim))
}

// One inference at a time; queries jump the queue so questions stay fast during indexing.
async function pump() {
  if (running) return
  running = true
  try {
    const extractor = await loading
    while (queue.length) {
      const task = queue.shift()
      try {
        const vectors = await embed(extractor, task)
        self.postMessage({ type: 'result', id: task.id, vectors }, vectors.map(v => v.buffer))
      } catch (err) {
        self.postMessage({ type: 'error', id: task.id, message: err.message })
      }
    }
  } catch {
    while (queue.length) self.postMessage({ type: 'error', id: queue.shift().id, message: 'Model unavailable' })
  } finally {
    running = false
  }
}

self.onmessage = ({ data }) => {
  if (data.type !== 'embed') return
  const task = { id: data.id, kind: data.kind, texts: data.texts }
  if (task.kind === 'query') queue.unshift(task)
  else queue.push(task)
  pump()
}
