import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BM25Index } from '../src/lib/bm25.js'
import { chunkPages } from '../src/lib/chunker.js'
import { Library } from '../src/lib/library.js'
import { buildSources, coverageSelect, mmrSelect, reciprocalRankFusion, retrieve } from '../src/lib/retrieval.js'

const topics = [
  'revenue profit earnings quarter',
  'vacation leave holidays employees',
  'office building riyadh opening',
  'security password encryption policy'
]

function bigDoc(docId, docName) {
  const pages = Array.from({ length: 30 }, (_, p) => ({
    page: p + 1,
    text: Array.from({ length: 8 }, (_, s) =>
      `On page ${p + 1} we discuss ${topics[p % 4]} in detail with filler words alpha beta gamma delta number ${s}.`
    ).join(' ')
  }))
  return chunkPages(pages, { docId, docName })
}

function libraryWith(...docs) {
  const library = new Library()
  for (const [docId, name] of docs) library.addDocument(docId, bigDoc(docId, name))
  return library
}

test('BM25 ranks matching chunks first and supports removal', () => {
  const index = new BM25Index()
  index.add([
    { id: 'a', docId: 'd1', text: 'The quarterly revenue grew strongly' },
    { id: 'b', docId: 'd1', text: 'Employees get vacation days' },
    { id: 'c', docId: 'd2', text: 'Revenue revenue revenue and profit' }
  ])
  const hits = index.search('revenue')
  assert.deepEqual(hits.map(h => h.id).sort(), ['a', 'c'])
  assert.equal(hits[0].id, 'c')
  index.removeDoc('d2')
  assert.deepEqual(index.search('revenue').map(h => h.id), ['a'])
  assert.equal(index.search('profit').length, 0)
  assert.equal(index.size, 2)
})

test('RRF rewards items ranked well by both lists', () => {
  const fused = reciprocalRankFusion([[{ id: 'x' }, { id: 'y' }], [{ id: 'y' }, { id: 'z' }]])
  assert.equal(fused[0].id, 'y')
  assert.equal(fused.length, 3)
})

test('MMR skips near-duplicates', () => {
  const chunks = {
    a: { id: 'a', text: 'alpha beta gamma delta', vec: new Float32Array([1, 0]) },
    b: { id: 'b', text: 'alpha beta gamma delta', vec: new Float32Array([1, 0]) },
    c: { id: 'c', text: 'something else', vec: new Float32Array([0, 1]) }
  }
  const candidates = [{ id: 'a', score: 1 }, { id: 'b', score: 0.99 }, { id: 'c', score: 0.6 }]
  assert.deepEqual(mmrSelect(candidates, id => chunks[id], { limit: 2, lambda: 0.5 }), ['a', 'c'])
})

test('small libraries are sent whole, one source per chunk, in order', () => {
  const library = new Library()
  const pages = [{ page: 1, text: 'Short doc about revenue.' }, { page: 2, text: 'Second page.' }]
  library.addDocument('d', chunkPages(pages, { docId: 'd', docName: 'tiny.pdf' }))
  const result = retrieve(library, { query: 'anything' })
  assert.equal(result.mode, 'full')
  assert.equal(result.sources[0].label, 'tiny.pdf, pp. 1–2')
})

test('hybrid search finds the relevant pages and labels them', () => {
  const result = retrieve(libraryWith(['d1', 'report.pdf']), { query: 'vacation leave for employees' })
  assert.equal(result.mode, 'search')
  assert.ok(result.sources.length > 0)
  assert.match(result.sources[0].text, /vacation/)
  assert.match(result.sources[0].label, /^report\.pdf, pp?\. \d+/)
  assert.equal(result.lowConfidence, false)
  result.sources.forEach((s, i) => assert.equal(s.n, i + 1))
})

test('semantic vectors are fused with keyword hits', () => {
  const library = libraryWith(['d1', 'report.pdf'])
  const target = library.allChunks()[5]
  for (const chunk of library.allChunks()) {
    chunk.vec = chunk === target ? new Float32Array([1, 0]) : new Float32Array([0, 1])
  }
  const result = retrieve(library, { query: 'zebra', queryVec: new Float32Array([1, 0]) })
  assert.equal(result.mode, 'search')
  assert.equal(result.sources[0].chunkId, target.id)
})

test('unmatched queries fall back to coverage and flag low confidence', () => {
  const result = retrieve(libraryWith(['d1', 'report.pdf']), { query: 'zebra xylophone' })
  assert.equal(result.mode, 'coverage')
  assert.equal(result.lowConfidence, true)
})

test('coverage spans the document and includes the opening', () => {
  const library = libraryWith(['d1', 'report.pdf'])
  const count = library.chunksOf('d1').length
  const indexes = coverageSelect(library).map(id => library.get(id).index)
  assert.equal(indexes[0], 0)
  assert.ok(Math.max(...indexes) >= count - 3, 'reaches the end of the document')
  assert.ok(indexes.length >= 3)
})

test('coverage uses embedding clusters when vectors exist', () => {
  const library = libraryWith(['d1', 'report.pdf'])
  library.allChunks().forEach((chunk, i) => {
    const v = new Float32Array(4)
    v[i % 4] = 1
    chunk.vec = v
  })
  const ids = coverageSelect(library)
  const clusters = new Set(ids.slice(1).map(id => library.get(id).index % 4))
  assert.ok(clusters.size >= 3, 'representatives come from different clusters')
})

test('broad questions focus on documents named in the question', () => {
  const library = libraryWith(['d1', 'employee-handbook.pdf'], ['d2', 'maritime-history.pdf'])
  const named = retrieve(library, { query: 'Summarize the handbook', scope: 'broad' })
  assert.equal(named.mode, 'coverage')
  assert.ok(named.sources.every(s => s.docId === 'd1'))
  const generic = retrieve(library, { query: 'Give me a summary', scope: 'broad' })
  const perDoc = id => generic.sources.filter(s => s.docId === id).length
  assert.ok(perDoc('d1') >= 2 && perDoc('d2') >= 2, 'equal coverage for every document')
  assert.ok(Math.abs(perDoc('d1') - perDoc('d2')) <= 1)
})

test('every chunk is its own source and repeated overlap is dropped', () => {
  const library = libraryWith(['d1', 'report.pdf'])
  const chunks = library.chunksOf('d1')
  const sources = buildSources([chunks[3].id, chunks[2].id, chunks[7].id], library)
  assert.deepEqual(sources.map(s => s.chunkId), [chunks[3].id, chunks[2].id, chunks[7].id])
  assert.deepEqual(sources.map(s => s.n), [1, 2, 3])
  assert.equal(sources[0].text, chunks[3].text.slice(chunks[3].bodyStart), 'predecessor included: overlap dropped')
  assert.equal(sources[1].text, chunks[2].text)
  assert.equal(sources[2].text, chunks[7].text)
  const inOrder = buildSources([chunks[7].id, chunks[2].id], library, { order: 'document' })
  assert.deepEqual(inOrder.map(s => s.chunkId), [chunks[2].id, chunks[7].id])
})

test('removing a document removes it from search', () => {
  const library = libraryWith(['d1', 'a.pdf'], ['d2', 'a.pdf'])
  library.removeDocument('d1')
  const result = retrieve(library, { query: 'revenue profit' })
  assert.ok(result.sources.length > 0)
  assert.ok(result.sources.every(s => s.docId === 'd2'))
})
