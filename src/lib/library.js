import { BM25Index } from './bm25.js'
import { chunkBody } from './chunker.js'

// In-memory store of every indexed chunk, its embedding vector (once computed) and the keyword index.
export class Library {
  constructor() {
    this.chunks = new Map() // chunkId -> chunk (+ vec: Float32Array once embedded)
    this.docChunkIds = new Map() // docId -> chunk ids in document order
    this.bm25 = new BM25Index()
  }

  addDocument(docId, chunks) {
    this.removeDocument(docId)
    this.docChunkIds.set(docId, chunks.map(c => c.id))
    for (const chunk of chunks) this.chunks.set(chunk.id, chunk)
    this.bm25.add(chunks)
  }

  removeDocument(docId) {
    const ids = this.docChunkIds.get(docId)
    if (!ids) return
    for (const id of ids) this.chunks.delete(id)
    this.bm25.removeDoc(docId)
    this.docChunkIds.delete(docId)
  }

  hasDocument(docId) {
    return this.docChunkIds.has(docId)
  }

  docIds() {
    return [...this.docChunkIds.keys()]
  }

  chunksOf(docId) {
    return (this.docChunkIds.get(docId) || []).map(id => this.chunks.get(id))
  }

  allChunks() {
    return this.docIds().flatMap(id => this.chunksOf(id))
  }

  get(id) {
    return this.chunks.get(id)
  }

  setVector(id, vec) {
    const chunk = this.chunks.get(id)
    if (chunk) chunk.vec = vec
  }

  get size() {
    return this.chunks.size
  }

  /** Characters of unique text across all documents (overlaps counted once). */
  bodyChars() {
    let total = 0
    for (const chunk of this.chunks.values()) total += chunkBody(chunk).length
    return total
  }
}
