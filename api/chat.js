// Free-tier proxy. The browser sends a question plus the excerpts it retrieved; the prompt,
// models and limits are decided here so the endpoint can't be used as a general-purpose LLM
// relay. Requests fall back across models/providers when one is rate limited or unavailable.

import {
  DAILY_HELPER_CALLS_PER_IP, DAILY_QUESTIONS_PER_IP,
  MAX_QUESTION_CHARS, MAX_SOURCES_CHARS
} from '../src/lib/config.js'
import { buildAnswerRequest, buildRewriteRequest, buildSuggestRequest } from '../src/lib/prompts.js'
import { fetchWithFallback, geminiProvider, groqProvider } from '../src/lib/providers.js'
import { clientIp, consume, refund } from './_ratelimit.js'

const MAX_BODY_BYTES = 64 * 1024
const MAX_SOURCES = 40

function sendJson(res, status, body, headers = {}) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
  res.end(JSON.stringify(body))
}

const fail = (res, status, message, { code, ...extra } = {}) =>
  sendJson(res, status, { error: { message, ...(code && { code }) }, ...extra })

// GROQ_API_KEY is the main provider; GEMINI_API_KEY (optional) adds overflow capacity.
function configuredProviders() {
  const providers = []
  if (process.env.GROQ_API_KEY) providers.push(groqProvider(process.env.GROQ_API_KEY))
  if (process.env.GEMINI_API_KEY) providers.push(geminiProvider(process.env.GEMINI_API_KEY, process.env.GEMINI_MODEL || undefined))
  return providers
}

function dailyLimit(bucket) {
  const [raw, fallback] = bucket === 'answer'
    ? [process.env.DAILY_QUESTIONS_PER_IP, DAILY_QUESTIONS_PER_IP]
    : [process.env.DAILY_HELPER_CALLS_PER_IP, DAILY_HELPER_CALLS_PER_IP]
  const value = raw === undefined || raw === '' ? fallback : Number(raw)
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

const ADD_KEY = 'Add your own free Groq key in Settings to keep going (it takes about a minute).'

function parseBody(req) {
  if (typeof req.body === 'string') return JSON.parse(req.body)
  return req.body
}

function validString(value, max) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max
}

function validHistory(history) {
  if (history === undefined) return []
  if (!Array.isArray(history)) return null
  return history.filter(m => m && typeof m.content === 'string' && (m.role === 'user' || m.role === 'assistant'))
}

function buildRequest(body) {
  const { mode } = body

  if (mode === 'answer') {
    const history = validHistory(body.history)
    const { sources } = body
    if (!validString(body.question, MAX_QUESTION_CHARS)) return { error: 'Invalid question.' }
    if (!history) return { error: 'Invalid history.' }
    if (!Array.isArray(sources) || sources.length === 0 || sources.length > MAX_SOURCES) return { error: 'Invalid sources.' }
    if (!sources.every(s => s && validString(s.label, 200) && typeof s.text === 'string')) return { error: 'Invalid sources.' }
    const total = sources.reduce((sum, s) => sum + s.text.length, 0)
    if (total > MAX_SOURCES_CHARS) return { error: 'Too much context.', status: 413 }
    return {
      bucket: 'answer',
      stream: true,
      request: buildAnswerRequest({
        question: body.question,
        history,
        sources: sources.map(s => ({ label: s.label, text: s.text })),
        scope: body.scope === 'broad' ? 'broad' : 'specific'
      })
    }
  }

  if (mode === 'rewrite') {
    const history = validHistory(body.history)
    if (!validString(body.question, MAX_QUESTION_CHARS) || !history) return { error: 'Invalid request.' }
    return { bucket: 'aux', request: buildRewriteRequest({ question: body.question, history }) }
  }

  if (mode === 'suggest') {
    if (!validString(body.excerpts, 6000)) return { error: 'Invalid request.' }
    return { bucket: 'aux', request: buildSuggestRequest({ excerpts: body.excerpts }) }
  }

  return { error: 'Unknown mode. Please refresh the page.' }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return fail(res, 405, 'Method not allowed.')
  }
  const providers = configuredProviders()
  if (!providers.length) return fail(res, 503, `The free service isn't configured. ${ADD_KEY}`, { code: 'capacity' })
  if (Number(req.headers['content-length'] || 0) > MAX_BODY_BYTES) return fail(res, 413, 'Request too large.')

  let body
  try {
    body = parseBody(req)
  } catch {
    return fail(res, 400, 'Invalid JSON.')
  }
  if (!body || typeof body !== 'object') return fail(res, 400, 'Invalid JSON.')

  const built = buildRequest(body)
  if (built.error) return fail(res, built.status || 400, built.error)

  // Per-visitor fair-use guard (0 disables it).
  const limit = dailyLimit(built.bucket)
  const quota = limit > 0 ? await consume(built.bucket, clientIp(req), limit) : null
  const headers = quota ? { 'X-Free-Remaining': String(quota.remaining) } : {}
  if (quota && !quota.allowed) {
    return fail(res, 429, `You've reached today's limit of ${limit} free questions. ${ADD_KEY}`, { remaining: 0, code: 'limit' })
  }

  const controller = new AbortController()
  res.on('close', () => { if (!res.writableFinished) controller.abort() })

  let upstream
  try {
    upstream = await fetchWithFallback({
      providers,
      request: built.request,
      stream: Boolean(built.stream),
      signal: controller.signal,
      onFailure: f => console.warn(`${f.provider} ${f.model} responded ${f.status}: ${f.detail.slice(0, 300)}`)
    })
  } catch (err) {
    if (quota) await refund(quota)
    if (controller.signal.aborted) return
    console.error('All providers failed:', err.message)
    if (err.rateLimited && (err.retryAfterMs === null || err.retryAfterMs > 120000)) {
      return fail(res, 503, `Today's shared free AI capacity is used up. ${ADD_KEY}`, { code: 'capacity' })
    }
    if (err.rateLimited) {
      return fail(res, 503, 'The free service is busy right now. Try again in a minute, or add your own free Groq key in Settings.', { code: 'busy' })
    }
    if (err.unauthorized) {
      return fail(res, 503, `The free service is unavailable right now. ${ADD_KEY}`, { code: 'capacity' })
    }
    return fail(res, 502, 'The language model returned an error. Please try again.')
  }
  headers['X-Model'] = upstream.model

  if (!built.stream) {
    const data = await upstream.response.json()
    return sendJson(res, 200, { content: data.choices?.[0]?.message?.content ?? '' }, headers)
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
    ...headers
  })
  try {
    const reader = upstream.response.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      res.write(value)
    }
  } catch (err) {
    if (!controller.signal.aborted) {
      console.error('Stream interrupted:', err)
      res.write(`data: ${JSON.stringify({ error: { message: 'The answer stream was interrupted.' } })}\n\n`)
    }
  }
  res.end()
}
