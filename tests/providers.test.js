import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildBody, fetchWithFallback, geminiProvider, groqProvider } from '../src/lib/providers.js'

const request = { tier: 'answer', messages: [{ role: 'user', content: 'hi' }], maxTokens: 100, temperature: 0.2 }

// Fake fetch: replies with the scripted responses in order and records which models were asked.
function scripted(...replies) {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, model: JSON.parse(init.body).model })
    const reply = replies.shift() || { status: 200 }
    return new Response(reply.body ?? '{}', { status: reply.status, headers: reply.headers })
  }
  return { fetchImpl, calls }
}

test('uses the first model when it answers', async () => {
  const { fetchImpl, calls } = scripted({ status: 200 })
  const result = await fetchWithFallback({ providers: [groqProvider('k')], request, fetchImpl })
  assert.equal(result.model, 'openai/gpt-oss-120b')
  assert.equal(calls.length, 1)
})

test('falls back to the next model when rate limited or the model is retired', async () => {
  for (const failure of [
    { status: 429, headers: { 'retry-after': '3600' } },
    { status: 404, body: '{"error":{"code":"model_not_found"}}' },
    { status: 400, body: '{"error":{"message":"The model `x` has been decommissioned"}}' },
    { status: 503 }
  ]) {
    const { fetchImpl, calls } = scripted(failure, { status: 200 })
    const result = await fetchWithFallback({ providers: [groqProvider('k')], request, fetchImpl })
    assert.equal(result.model, 'openai/gpt-oss-20b', `after ${failure.status}`)
    assert.deepEqual(calls.map(c => c.model), ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'])
  }
})

test('stops on a malformed request instead of trying other models', async () => {
  const { fetchImpl, calls } = scripted({ status: 400, body: '{"error":{"message":"messages must not be empty"}}' })
  await assert.rejects(
    fetchWithFallback({ providers: [groqProvider('k')], request, fetchImpl }),
    err => err.status === 400 && err.message === 'messages must not be empty'
  )
  assert.equal(calls.length, 1)
})

test('skips a provider with a bad key and uses the next provider', async () => {
  const { fetchImpl, calls } = scripted({ status: 401 }, { status: 200 })
  const result = await fetchWithFallback({ providers: [groqProvider('bad'), geminiProvider('g')], request, fetchImpl })
  assert.equal(result.provider, 'gemini')
  assert.equal(calls[1].url.includes('generativelanguage.googleapis.com'), true)
})

test('reports an invalid key when no provider accepts it', async () => {
  const { fetchImpl } = scripted({ status: 401 })
  await assert.rejects(fetchWithFallback({ providers: [groqProvider('bad')], request, fetchImpl }), err => err.unauthorized)
})

test('waits once for short per-minute limits, then retries', async () => {
  const short = { status: 429, headers: { 'retry-after': '0.01' } }
  const { fetchImpl, calls } = scripted(short, short, { status: 200 })
  const result = await fetchWithFallback({ providers: [groqProvider('k')], request, fetchImpl })
  assert.equal(calls.length, 3)
  assert.equal(result.model, 'openai/gpt-oss-120b')
})

test('gives up with the retry time when daily limits are exhausted', async () => {
  const daily = { status: 429, headers: { 'retry-after': '3600' } }
  const { fetchImpl } = scripted(daily, daily)
  await assert.rejects(
    fetchWithFallback({ providers: [groqProvider('k')], request, fetchImpl }),
    err => err.rateLimited && err.retryAfterMs === 3600000
  )
})

test('builds provider-specific bodies', () => {
  const groq = buildBody({ ...request, json: true }, groqProvider('k'), 'openai/gpt-oss-120b', true)
  assert.equal(groq.max_completion_tokens, 100)
  assert.equal(groq.reasoning_effort, 'low')
  assert.equal(groq.include_reasoning, false)
  assert.deepEqual(groq.response_format, { type: 'json_object' })
  assert.equal(groq.stream, true)

  const gemini = buildBody(request, geminiProvider('g'), 'gemini-3.5-flash-lite', false)
  assert.equal(gemini.max_tokens, 100)
  assert.equal(gemini.include_reasoning, undefined)
  assert.equal(gemini.response_format, undefined)
})
