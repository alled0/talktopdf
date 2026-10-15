// LLM providers and automatic fallback, shared by the /api/chat proxy and the own-key path.
//
// Free tiers are capped per model (Groq) or per project (Gemini), so a request that hits a rate
// limit, a retired model or a provider outage moves on to the next model/provider instead of
// failing. Models are listed best-first for each tier:
//   answer: writing the grounded answer       fast: query rewriting and starter questions

import { GEMINI_URL, GROQ_URL } from './config.js'

export const GROQ_MODELS = {
  answer: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'],
  fast: ['openai/gpt-oss-20b', 'openai/gpt-oss-120b']
}

export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite'

export function groqProvider(apiKey) {
  return {
    name: 'groq',
    url: GROQ_URL,
    apiKey,
    models: GROQ_MODELS,
    maxTokensField: 'max_completion_tokens',
    // gpt-oss models reason before answering; keep it short and out of the response.
    extra: { reasoning_effort: 'low', include_reasoning: false }
  }
}

export function geminiProvider(apiKey, model = DEFAULT_GEMINI_MODEL) {
  return {
    name: 'gemini',
    url: GEMINI_URL,
    apiKey,
    models: { answer: [model], fast: [model] },
    maxTokensField: 'max_tokens',
    extra: { reasoning_effort: 'low' }
  }
}

/** Turns a provider-neutral request ({tier, messages, maxTokens, temperature, json}) into an API body. */
export function buildBody(request, provider, model, stream) {
  const body = {
    model,
    messages: request.messages,
    temperature: request.temperature,
    [provider.maxTokensField]: request.maxTokens,
    stream,
    ...provider.extra
  }
  if (request.json) body.response_format = { type: 'json_object' }
  return body
}

const RETIRED_MODEL = /model.*(not found|not exist|decommission|deprecat|not supported|unavailable)|model_not_found/i

// Is it worth trying the next model/provider after this failure?
function nextAction(status, detail) {
  if (status === 401 || status === 403) return 'next-provider' // bad or missing key for this provider
  if (status === 429) return 'next-model'
  if (status === 404 || status >= 500) return 'next-model'
  if (status === 400 && RETIRED_MODEL.test(detail)) return 'next-model'
  return 'stop' // malformed request: other models would reject it too
}

function retryAfterMs(res) {
  const header = res.headers.get('retry-after')
  const seconds = Number(header)
  return Number.isFinite(seconds) && header !== null ? seconds * 1000 : null
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, ms)
  signal?.addEventListener('abort', () => {
    clearTimeout(timer)
    reject(new DOMException('Aborted', 'AbortError'))
  }, { once: true })
})

export class ProviderError extends Error {
  constructor(message, { status, rateLimited = false, retryAfterMs = null, unauthorized = false } = {}) {
    super(message)
    this.name = 'ProviderError'
    this.status = status
    this.rateLimited = rateLimited
    this.retryAfterMs = retryAfterMs
    this.unauthorized = unauthorized
  }
}

/**
 * Sends `request` to the first provider/model that accepts it.
 * If every option is only briefly rate limited (per-minute limits), waits once and retries.
 * @returns {Promise<{response: Response, provider: string, model: string}>}
 */
export async function fetchWithFallback({ providers, request, stream = false, signal, fetchImpl = fetch, maxWaitMs = 6000, onFailure }) {
  const send = ({ provider, model }) => fetchImpl(provider.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(buildBody(request, provider, model, stream)),
    signal
  })

  const rateLimited = []
  let last = null

  for (const provider of providers) {
    for (const model of provider.models[request.tier]) {
      const attempt = { provider, model }
      const res = await send(attempt)
      if (res.ok) return { response: res, provider: provider.name, model }

      const detail = await res.text().catch(() => '')
      last = { status: res.status, detail }
      onFailure?.({ provider: provider.name, model, status: res.status, detail })
      if (res.status === 429) rateLimited.push({ attempt, wait: retryAfterMs(res) })

      const action = nextAction(res.status, detail)
      if (action === 'stop') throw new ProviderError(errorMessage(detail, res.status), { status: res.status })
      if (action === 'next-provider') break
    }
  }

  // Everything is rate limited. Per-minute limits clear quickly, so wait once if that's cheap.
  const waits = rateLimited.map(r => r.wait).filter(w => w !== null)
  const shortest = waits.length ? Math.min(...waits) : null
  if (rateLimited.length && shortest !== null && shortest <= maxWaitMs) {
    await sleep(shortest + 250, signal)
    const retry = rateLimited.find(r => r.wait === shortest).attempt
    const res = await send(retry)
    if (res.ok) return { response: res, provider: retry.provider.name, model: retry.model }
    last = { status: res.status, detail: await res.text().catch(() => '') }
  }

  if (rateLimited.length) {
    throw new ProviderError('All models are rate limited.', { status: 429, rateLimited: true, retryAfterMs: shortest })
  }
  throw new ProviderError(errorMessage(last?.detail, last?.status), {
    status: last?.status || 502,
    unauthorized: last?.status === 401 || last?.status === 403
  })
}

function errorMessage(detail, status) {
  try {
    const message = JSON.parse(detail)?.error?.message
    if (message) return message
  } catch {
    // not JSON
  }
  return `The language model returned an error (${status}).`
}
