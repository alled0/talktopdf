// Per-IP daily quotas for the free proxy.
// Uses Upstash Redis (or Vercel KV, which is Upstash) over REST when configured,
// and falls back to process memory, which is best effort on serverless.

const memory = new Map()
let memoryDay = ''

function redisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN
  return url && token ? { url: url.replace(/\/$/, ''), token } : null
}

async function redisPipeline(commands) {
  const { url, token } = redisConfig()
  const res = await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands)
  })
  if (!res.ok) throw new Error(`rate limit store responded ${res.status}`)
  return res.json()
}

function memoryIncrement(key, day, by) {
  if (day !== memoryDay) {
    memory.clear()
    memoryDay = day
  }
  const next = Math.max(0, (memory.get(key) || 0) + by)
  memory.set(key, next)
  return next
}

export function clientIp(req) {
  const forwarded = req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'] || req.headers['x-real-ip']
  const ip = String(forwarded || req.socket?.remoteAddress || 'unknown').split(',')[0].trim()
  return ip || 'unknown'
}

export async function consume(bucket, ip, limit) {
  const day = new Date().toISOString().slice(0, 10)
  const key = `ttp:${bucket}:${day}:${ip}`
  let count
  if (redisConfig()) {
    try {
      const [incr] = await redisPipeline([['INCR', key], ['EXPIRE', key, 172800]])
      count = Number(incr.result)
    } catch (err) {
      console.error('Rate limit store unavailable, using memory:', err.message)
      count = memoryIncrement(key, day, 1)
    }
  } else {
    count = memoryIncrement(key, day, 1)
  }
  return { allowed: count <= limit, remaining: Math.max(0, limit - count), key, day }
}

// Give a request back when the upstream call failed, so errors don't burn quota.
export async function refund({ key, day }) {
  if (redisConfig()) {
    try {
      await redisPipeline([['DECR', key]])
      return
    } catch {
      // fall through to memory
    }
  }
  memoryIncrement(key, day, -1)
}
