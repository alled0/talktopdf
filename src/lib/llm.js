import { GROQ_URL } from './config.js'
import { buildAnswerRequest, buildRewriteRequest, buildSuggestRequest, parseJsonContent } from './prompts.js'

export class ApiError extends Error {
  constructor(message, { status, limitReached = false } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.limitReached = limitReached
  }
}

// With a key we call Groq directly from the browser; otherwise the free proxy builds
// the identical request server-side from the same payload.
function send(apiKey, payload, buildGroqRequest, { stream = false, signal } = {}) {
  if (apiKey) {
    return fetch(GROQ_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...buildGroqRequest(payload), stream }),
      signal
    })
  }
  return fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal
  })
}

async function toError(res, apiKey) {
  const data = await res.json().catch(() => null)
  const detail = data?.error?.message
  if (apiKey && res.status === 401) return new ApiError('Groq rejected your API key. Check it in Settings.', { status: 401 })
  if (apiKey && res.status === 429) return new ApiError('Your Groq key hit its rate limit. Wait a moment and try again.', { status: 429 })
  if (!apiKey && res.status === 429) return new ApiError(detail || 'Daily free limit reached.', { status: 429, limitReached: true })
  return new ApiError(detail || `Request failed (${res.status}).`, { status: res.status })
}

function freeRemaining(res) {
  const value = res.headers.get('X-Free-Remaining')
  return value === null ? null : Number(value)
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
 */
export async function streamAnswer({ apiKey, question, history, sources, scope, signal, onText }) {
  const payload = {
    mode: 'answer',
    question,
    history: history.map(m => ({ role: m.role, content: m.content })),
    sources: sources.map(s => ({ label: s.label, text: s.text })),
    scope
  }
  const res = await send(apiKey, payload, buildAnswerRequest, { stream: true, signal })
  if (!res.ok) throw await toError(res, apiKey)

  let text = ''
  for await (const delta of readEventStream(res.body)) {
    text += delta
    onText?.(text)
  }
  return { text, remaining: apiKey ? null : freeRemaining(res) }
}

async function completeJson(apiKey, payload, buildGroqRequest, signal) {
  const res = await send(apiKey, payload, buildGroqRequest, { signal })
  if (!res.ok) throw await toError(res, apiKey)
  const data = await res.json()
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
