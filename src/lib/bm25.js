import { tokenize } from './text.js'

// Okapi BM25 over a sparse inverted index. Chunks can be added and removed incrementally.
export class BM25Index {
  constructor({ k1 = 1.2, b = 0.75 } = {}) {
    this.k1 = k1
    this.b = b
    this.entries = new Map() // chunkId -> { docId, length, terms }
    this.postings = new Map() // term -> Map(chunkId -> term frequency)
    this.totalLength = 0
  }

  get size() {
    return this.entries.size
  }

  add(chunks) {
    for (const chunk of chunks) {
      if (this.entries.has(chunk.id)) this.removeChunk(chunk.id)
      const tokens = tokenize(chunk.text)
      const tf = new Map()
      for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1)

      this.entries.set(chunk.id, { docId: chunk.docId, length: tokens.length, terms: [...tf.keys()] })
      this.totalLength += tokens.length
      for (const [term, count] of tf) {
        let posting = this.postings.get(term)
        if (!posting) this.postings.set(term, posting = new Map())
        posting.set(chunk.id, count)
      }
    }
  }

  removeChunk(id) {
    const entry = this.entries.get(id)
    if (!entry) return
    for (const term of entry.terms) {
      const posting = this.postings.get(term)
      posting.delete(id)
      if (posting.size === 0) this.postings.delete(term)
    }
    this.totalLength -= entry.length
    this.entries.delete(id)
  }

  removeDoc(docId) {
    for (const [id, entry] of this.entries) {
      if (entry.docId === docId) this.removeChunk(id)
    }
  }

  /** @returns {{id: string, score: number}[]} best first */
  search(query, limit = 30) {
    const n = this.entries.size
    if (n === 0) return []
    const avgLength = this.totalLength / n || 1
    const scores = new Map()

    for (const term of new Set(tokenize(query))) {
      const posting = this.postings.get(term)
      if (!posting) continue
      const idf = Math.log(1 + (n - posting.size + 0.5) / (posting.size + 0.5))
      for (const [id, tf] of posting) {
        const length = this.entries.get(id).length
        const norm = tf + this.k1 * (1 - this.b + this.b * length / avgLength)
        scores.set(id, (scores.get(id) || 0) + idf * (tf * (this.k1 + 1)) / norm)
      }
    }

    return [...scores]
      .map(([id, score]) => ({ id, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  }
}
