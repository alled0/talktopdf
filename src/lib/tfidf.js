export function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1)
}

export function buildVocab(chunks) {
  const vocab = new Map()
  let idx = 0
  for (const chunk of chunks) {
    for (const token of tokenize(chunk.text)) {
      if (!vocab.has(token)) vocab.set(token, idx++)
    }
  }
  return vocab
}

export function buildIDF(chunks, vocab) {
  const N = chunks.length
  const df = new Map()

  for (const chunk of chunks) {
    for (const token of new Set(tokenize(chunk.text))) {
      if (vocab.has(token)) df.set(token, (df.get(token) || 0) + 1)
    }
  }

  const idf = new Map()
  for (const [token] of vocab) {
    const freq = df.get(token) || 0
    idf.set(token, Math.log((N + 1) / (freq + 1)) + 1)
  }
  return idf
}

export function tfidf(text, vocab, idf) {
  const tokens = tokenize(text)
  const tf = new Map()
  for (const token of tokens) tf.set(token, (tf.get(token) || 0) + 1)

  const vec = new Float32Array(vocab.size)
  for (const [token, count] of tf) {
    if (vocab.has(token)) {
      vec[vocab.get(token)] = (count / tokens.length) * (idf.get(token) || 1)
    }
  }
  return vec
}

export function cosineSim(a, b) {
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

export function retrieve(queryVec, chunks, topK = 6, minScore = 0.01) {
  return chunks
    .map(chunk => ({ chunk, score: chunk.vec ? cosineSim(queryVec, chunk.vec) : 0 }))
    .filter(item => item.score > minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(item => item.chunk)
}
