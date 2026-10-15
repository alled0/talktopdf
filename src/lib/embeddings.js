// Main-thread client for the embedding worker. The model is downloaded lazily (once, then
// cached by the browser) the first time a document is indexed.

let worker = null
let nextId = 0
const pending = new Map()
const listeners = new Set()
let state = { status: 'idle', progress: 0, error: null } // idle | loading | ready | error

function setState(patch) {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}

export function subscribeEmbedState(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const getEmbedState = () => state

function rejectAll(message) {
  for (const { reject } of pending.values()) reject(new Error(message))
  pending.clear()
}

function ensureWorker() {
  if (worker) return worker
  worker = new Worker(new URL('../workers/embed.worker.js', import.meta.url), { type: 'module' })
  setState({ status: 'loading', progress: 0, error: null })

  worker.onmessage = ({ data }) => {
    if (data.type === 'progress') {
      setState({ status: 'loading', progress: data.progress })
    } else if (data.type === 'ready') {
      setState({ status: 'ready', progress: 100 })
    } else if (data.type === 'result') {
      pending.get(data.id)?.resolve(data.vectors)
      pending.delete(data.id)
    } else if (data.type === 'error' && data.id !== undefined) {
      pending.get(data.id)?.reject(new Error(data.message))
      pending.delete(data.id)
    } else if (data.type === 'error') {
      setState({ status: 'error', error: data.message })
      rejectAll(data.message)
    }
  }
  worker.onerror = event => {
    setState({ status: 'error', error: event.message || 'Semantic search failed to start.' })
    rejectAll('Semantic search failed to start.')
  }
  return worker
}

/** Discards a failed worker so the next request starts a fresh download attempt. */
export function resetEmbedder() {
  worker?.terminate()
  worker = null
  rejectAll('Semantic search was restarted.')
  setState({ status: 'idle', progress: 0, error: null })
}

function request(kind, texts) {
  const w = ensureWorker()
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    w.postMessage({ type: 'embed', id, kind, texts })
  })
}

/** Starts loading the model (from the browser cache after the first time). */
export function warmUpEmbedder() {
  ensureWorker()
}

/** Embeds document passages. Starts the model download if needed. */
export function embedPassages(texts) {
  return request('passage', texts)
}

/** Embeds a search query, or returns null when the model isn't ready yet. */
export async function embedQuery(text) {
  if (state.status !== 'ready') return null
  try {
    const [vector] = await request('query', [text])
    return vector
  } catch {
    return null
  }
}
