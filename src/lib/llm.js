import { buildAnswerRequest, buildRewriteRequest, buildSuggestRequest, parseJsonContent } from './prompts.js'
import { fetchWithFallback, groqProvider } from './providers.js'

export class ApiError extends Error {
  /**
   * @param {object} options
   * @param {'limit'|'capacity'|'busy'|undefined} options.code
   *   limit: this visitor's daily free questions are used up
   *   capacity: the shared free tier can't serve requests (adding an own key fixes it)
   *   busy: briefly rate limited, retrying soon should work
   */
  constructor(message, { status, code } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }

  get needsOwnKey() {
    return this.code === 'limit' || this.code === 'capacity'
  }
}

// With a key we call Groq directly from the browser (falling back across Groq models);
// otherwise the free proxy builds the identical request server-side from the same payload.
async function send(apiKey, payload, buildRequest, { stream = false, signal } = {}) {
  if (apiKey) {
    try {
      const { response, model } = await fetchWithFallback({
        providers: [groqProvider(apiKey)],
        request: buildRequest(payload),
        stream,
        signal
      })
      return { response, model, remaining: null }
    } catch (err) {
      if (err.name === 'AbortError') throw err
      if (err.unauthorized) throw new ApiError('Groq rejected your API key. Check it in Settings.', { status: 401 })
      if (err.rateLimited) throw new ApiError('Your Groq key hit its rate limit. Wait a minute and try again.', { status: 429, code: 'busy' })
      throw new ApiError(err.message, { status: err.status })
    }
  }

  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal
  })
  if (!response.ok) {
    const data = await response.json().catch(() => null)
    throw new ApiError(data?.error?.message || `Request failed (${response.status}).`, {
      status: response.status,
      code: data?.error?.code
    })
  }
  const remaining = response.headers.get('X-Free-Remaining')
  return { response, model: response.headers.get('X-Model'), remaining: remaining === null ? null : Number(remaining) }
}

async function* readEventStream(body) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return
    buffer += decoder.decode(value, { stream: true })
    let newline
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') return
      let event
      try { event = JSON.parse(data) } catch { continue }
      if (event.error) throw new ApiError(event.error.message || 'The answer stream failed.')
      const delta = event.choices?.[0]?.delta?.content
      if (delta) yield delta
    }
  }
}

/**
 * Streams an answer grounded in `sources` ({label, text}). Calls onText with the
 * accumulated text as tokens arrive. Rejects with an AbortError if `signal` aborts.
 * @returns {Promise<{text: string, remaining: number|null, model: string|null}>}
 */
export async function streamAnswer({ apiKey, question, history, sources, scope, signal, onText }) {
  const payload = {
    mode: 'answer',
    question,
    history: history.map(m => ({ role: m.role, content: m.content })),
    sources: sources.map(s => ({ label: s.label, text: s.text })),
    scope
  }
  const { response, model, remaining } = await send(apiKey, payload, buildAnswerRequest, { stream: true, signal })

  let text = ''
  for await (const delta of readEventStream(response.body)) {
    text += delta
    onText?.(text)
  }
  return { text, remaining, model }
}

async function completeJson(apiKey, payload, buildRequest, signal) {
  const { response } = await send(apiKey, payload, buildRequest, { signal })
  const data = await response.json()
  const content = apiKey ? data.choices?.[0]?.message?.content : data.content
  return parseJsonContent(content)
}

/** Rewrites a follow-up into a standalone query. Returns {query, scope} or null. */
export async function rewriteQuery({ apiKey, question, history, signal }) {
  try {
    const json = await completeJson(apiKey, {
      mode: 'rewrite',
      question,
      history: history.map(m => ({ role: m.role, content: m.content }))
    }, buildRewriteRequest, signal)
    if (!json || typeof json.query !== 'string' || !json.query.trim()) return null
    return { query: json.query.trim(), scope: json.scope === 'broad' ? 'broad' : 'specific' }
  } catch (err) {
    if (err.name === 'AbortError') throw err
    return null
  }
}

/** Generates starter questions from document excerpts. Returns [] on failure. */
export async function suggestQuestions({ apiKey, excerpts }) {
  try {
    const json = await completeJson(apiKey, { mode: 'suggest', excerpts }, buildSuggestRequest)
    const questions = Array.isArray(json?.questions) ? json.questions : []
    return questions.filter(q => typeof q === 'string' && q.trim()).map(q => q.trim()).slice(0, 4)
  } catch {
    return []
  }
}
