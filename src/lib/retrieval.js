// Hybrid retrieval: BM25 keyword search + embedding similarity, fused with Reciprocal Rank
// Fusion, diversified with MMR and grouped into citable sources.

import { chunkBody } from './chunker.js'
import { FULL_DOC_CHAR_LIMIT, RETRIEVAL_CHAR_BUDGET } from './config.js'
import { formatPages, stripExtension } from './format.js'
import { tokenize } from './text.js'

const POOL_SIZE = 30
const RRF_K = 60
const MAX_RESULTS = 6
const MIN_RELATIVE_SCORE = 0.4 // drop fused hits scoring below 40% of the best one
const MAX_COVERAGE = 10
const LOW_SIMILARITY = 0.75

export function dot(a, b) {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i]
  return sum
}

export function vectorSearch(chunks, queryVec, limit = POOL_SIZE) {
  return chunks
    .filter(c => c.vec)
    .map(c => ({ id: c.id, score: dot(queryVec, c.vec) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

/** Merges several best-first rankings: score = Σ 1 / (k + rank). */
export function reciprocalRankFusion(rankings, k = RRF_K) {
  const scores = new Map()
  for (const ranking of rankings) {
    ranking.forEach(({ id }, rank) => scores.set(id, (scores.get(id) || 0) + 1 / (k + rank + 1)))
  }
  return [...scores].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score)
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0
  let shared = 0
  for (const t of a) if (b.has(t)) shared++
  return shared / (a.size + b.size - shared)
}

/**
 * Maximal Marginal Relevance: greedily picks relevant candidates that are not near-duplicates
 * of what is already picked, until `limit` or the character `budget` is reached.
 */
export function mmrSelect(candidates, getChunk, { lambda = 0.75, limit = MAX_RESULTS, budget = RETRIEVAL_CHAR_BUDGET } = {}) {
  if (!candidates.length) return []
  const maxScore = candidates[0].score || 1
  const pool = candidates.map(c => ({ ...c, chunk: getChunk(c.id), relevance: c.score / maxScore }))
  const tokenSets = new Map()
  const tokensOf = chunk => {
    if (!tokenSets.has(chunk.id)) tokenSets.set(chunk.id, new Set(tokenize(chunk.text)))
    return tokenSets.get(chunk.id)
  }
  const similarity = (a, b) => (a.vec && b.vec ? dot(a.vec, b.vec) : jaccard(tokensOf(a), tokensOf(b)))

  const selected = []
  let used = 0
  while (pool.length && selected.length < limit) {
    let bestIndex = -1
    let bestValue = -Infinity
    pool.forEach((candidate, i) => {
      const redundancy = selected.length ? Math.max(...selected.map(s => similarity(candidate.chunk, s.chunk))) : 0
      const value = lambda * candidate.relevance - (1 - lambda) * redundancy
      if (value > bestValue) { bestValue = value; bestIndex = i }
    })
    const [best] = pool.splice(bestIndex, 1)
    if (selected.length && used + best.chunk.text.length > budget) continue
    selected.push(best)
    used += best.chunk.text.length
  }
  return selected.map(s => s.id)
}

/** Adds the chunk after (then before) the strongest hits while budget remains. */
export function expandNeighbors(ids, library, budget = RETRIEVAL_CHAR_BUDGET) {
  const result = [...ids]
  const chosen = new Set(ids)
  let used = ids.reduce((sum, id) => sum + library.get(id).text.length, 0)

  for (const id of ids.slice(0, 2)) {
    const chunk = library.get(id)
    const siblings = library.chunksOf(chunk.docId)
    for (const neighbor of [siblings[chunk.index + 1], siblings[chunk.index - 1]]) {
      if (!neighbor || chosen.has(neighbor.id)) continue
      const cost = chunkBody(neighbor).length
      if (used + cost > budget) continue
      result.push(neighbor.id)
      chosen.add(neighbor.id)
      used += cost
    }
  }
  return result
}

function nearestIndex(vectors, centroid) {
  let best = 0
  let bestScore = -Infinity
  vectors.forEach((v, i) => {
    const score = dot(v, centroid)
    if (score > bestScore) { bestScore = score; best = i }
  })
  return best
}

// k-means over normalized embeddings; returns the chunk index closest to each centroid.
function representativeIndexes(vectors, k) {
  const dim = vectors[0].length
  let centroids = Array.from({ length: k }, (_, i) => vectors[Math.floor((i + 0.5) * vectors.length / k)])
  let assignment = []
  for (let iter = 0; iter < 10; iter++) {
    assignment = vectors.map(v => nearestIndex(centroids, v))
    centroids = centroids.map((old, c) => {
      const sum = new Float32Array(dim)
      let count = 0
      vectors.forEach((v, i) => {
        if (assignment[i] !== c) return
        count++
        for (let d = 0; d < dim; d++) sum[d] += v[d]
      })
      if (!count) return old
      const norm = Math.hypot(...sum) || 1
      return sum.map(x => x / norm)
    })
  }
  const picks = new Set()
  centroids.forEach((centroid, c) => {
    const members = vectors.map((v, i) => i).filter(i => assignment[i] === c)
    if (members.length) picks.add(members[nearestIndex(members.map(i => vectors[i]), centroid)])
  })
  return [...picks]
}

function spreadIndexes(n, k) {
  if (k === 1) return [0]
  return [...new Set(Array.from({ length: k }, (_, i) => Math.round(i * (n - 1) / (k - 1))))]
}

/**
 * Picks chunks that together cover each document: the opening chunk plus one representative per
 * topic cluster (or evenly spaced chunks when embeddings aren't ready). Used for broad questions.
 */
export function coverageSelect(library, { docIds = library.docIds(), budget = RETRIEVAL_CHAR_BUDGET } = {}) {
  const docs = docIds.map(id => library.chunksOf(id)).filter(c => c.length)
  const all = docs.flat()
  if (!all.length) return []
  const avgLength = all.reduce((sum, c) => sum + c.text.length, 0) / all.length
  const target = Math.max(docs.length, Math.min(MAX_COVERAGE, Math.floor(budget / avgLength)))

  const picks = []
  for (const chunks of docs) {
    // Equal share per document, so one long file doesn't crowd out the others.
    const quota = Math.max(1, Math.floor(target / docs.length))
    if (quota >= chunks.length) {
      picks.push(...chunks)
      continue
    }
    const rest = chunks.slice(1)
    let indexes
    if (quota === 1) indexes = []
    else if (rest.every(c => c.vec)) indexes = representativeIndexes(rest.map(c => c.vec), quota - 1)
    else indexes = spreadIndexes(rest.length, quota - 1)
    picks.push(chunks[0], ...indexes.map(i => rest[i]))
  }

  let used = 0
  return picks
    .sort((a, b) => a.index - b.index)
    .filter(c => (used += c.text.length) <= budget * 1.1 || c.index === 0)
    .map(c => c.id)
}

/**
 * Turns chunk ids into numbered sources, one per chunk so every citation points at a precise
 * page range. When a chunk's predecessor is also included, its repeated overlap is dropped.
 */
export function buildSources(ids, library, { order = 'rank' } = {}) {
  const docOrder = new Map(library.docIds().map((id, i) => [id, i]))
  const chunks = [...new Set(ids)].map(id => library.get(id)).filter(Boolean)
  const included = new Set(chunks.map(c => c.id))
  const rank = new Map(chunks.map((c, i) => [c.id, i]))

  if (order === 'document') {
    chunks.sort((a, b) => docOrder.get(a.docId) - docOrder.get(b.docId) || a.index - b.index)
  }

  return chunks.map((chunk, i) => {
    const previous = library.chunksOf(chunk.docId)[chunk.index - 1]
    const continues = previous && included.has(previous.id)
    return {
      n: i + 1,
      docId: chunk.docId,
      docName: chunk.docName,
      pageStart: chunk.pageStart,
      pageEnd: chunk.pageEnd,
      part: chunk.index + 1,
      label: `${chunk.docName}, ${formatPages(chunk.pageStart, chunk.pageEnd) || `part ${chunk.index + 1}`}`,
      text: continues ? chunkBody(chunk) : chunk.text,
      chunkId: chunk.id,
      rank: rank.get(chunk.id)
    }
  })
}

/** Documents whose file name is mentioned in the query ("summarize the handbook"), else all. */
export function focusDocuments(library, query) {
  const queryTokens = new Set(tokenize(query))
  const named = library.docIds().filter(id => {
    const name = library.chunksOf(id)[0]?.docName || ''
    return tokenize(stripExtension(name).replace(/[_-]+/g, ' ')).some(t => queryTokens.has(t))
  })
  return named.length ? named : library.docIds()
}

/**
 * Chooses the excerpts to send for a question.
 * - Small libraries are sent whole ("full").
 * - Broad questions get chunks that cover each document ("coverage").
 * - Everything else uses hybrid search ("search").
 */
export function retrieve(library, { query, queryVec = null, scope = 'specific' }) {
  if (library.size === 0) return { mode: 'empty', sources: [], lowConfidence: true }

  if (library.bodyChars() <= FULL_DOC_CHAR_LIMIT) {
    const ids = library.allChunks().map(c => c.id)
    return { mode: 'full', sources: buildSources(ids, library, { order: 'document' }), lowConfidence: false }
  }

  if (scope === 'broad') {
    const ids = coverageSelect(library, { docIds: focusDocuments(library, query) })
    return { mode: 'coverage', sources: buildSources(ids, library, { order: 'document' }), lowConfidence: false }
  }

  const keyword = library.bm25.search(query, POOL_SIZE)
  const semantic = queryVec ? vectorSearch(library.allChunks(), queryVec, POOL_SIZE) : []
  const fused = reciprocalRankFusion([keyword, semantic].filter(r => r.length))

  if (!fused.length) {
    return { mode: 'coverage', sources: buildSources(coverageSelect(library), library, { order: 'document' }), lowConfidence: true }
  }

  const threshold = fused[0].score * MIN_RELATIVE_SCORE
  const selected = mmrSelect(fused.filter(r => r.score >= threshold), id => library.get(id))
  const ids = expandNeighbors(selected, library)
  return {
    mode: 'search',
    sources: buildSources(ids, library, { order: 'rank' }),
    lowConfidence: keyword.length === 0 && (!semantic.length || semantic[0].score < LOW_SIMILARITY),
    semantic: semantic.length > 0
  }
}
