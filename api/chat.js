// Free-tier proxy to Groq. The browser sends a question plus the excerpts it retrieved;
// the prompt, model and limits are decided here so the endpoint can't be used as a
// general-purpose LLM relay.

import {
  GROQ_URL, FREE_DAILY_ANSWERS, FREE_DAILY_AUX,
  MAX_QUESTION_CHARS, MAX_SOURCES_CHARS
} from '../src/lib/config.js'
import { buildAnswerRequest, buildRewriteRequest, buildSuggestRequest } from '../src/lib/prompts.js'
import { clientIp, consume, refund } from './_ratelimit.js'

const MAX_BODY_BYTES = 64 * 1024
const MAX_SOURCES = 40

function sendJson(res, status, body, headers = {}) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
  res.end(JSON.stringify(body))
}

const fail = (res, status, message, extra = {}) => sendJson(res, status, { error: { message }, ...extra })

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
  if (!process.env.GROQ_API_KEY) return fail(res, 500, 'The server is missing GROQ_API_KEY.')
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

  const limit = built.bucket === 'answer' ? FREE_DAILY_ANSWERS : FREE_DAILY_AUX
  const quota = await consume(built.bucket, clientIp(req), limit)
  const quotaHeaders = { 'X-Free-Remaining': String(quota.remaining) }
  if (!quota.allowed) {
    return fail(res, 429, `You've used today's ${limit} free questions. Add your own free Groq API key in Settings to keep going.`, { remaining: 0 })
  }

  const controller = new AbortController()
  res.on('close', () => { if (!res.writableFinished) controller.abort() })

  let upstream
  try {
    upstream = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...built.request, stream: Boolean(built.stream) }),
      signal: controller.signal
    })
  } catch (err) {
    await refund(quota)
    if (controller.signal.aborted) return
    console.error('Groq request failed:', err)
    return fail(res, 502, 'Could not reach the language model. Please try again.')
  }

  if (!upstream.ok) {
    await refund(quota)
    const detail = await upstream.text().catch(() => '')
    console.error(`Groq responded ${upstream.status}:`, detail.slice(0, 500))
    if (upstream.status === 429) {
      return fail(res, 503, 'The free service is busy right now. Try again in a minute, or add your own Groq API key in Settings.')
    }
    return fail(res, 502, 'The language model returned an error. Please try again.')
  }

  if (!built.stream) {
    const data = await upstream.json()
    return sendJson(res, 200, { content: data.choices?.[0]?.message?.content ?? '' }, quotaHeaders)
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
    ...quotaHeaders
  })
  try {
    const reader = upstream.body.getReader()
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
