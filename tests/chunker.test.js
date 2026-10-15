import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chunkBody, chunkPages } from '../src/lib/chunker.js'

const sentence = (n, words = 12) =>
  `Sentence ${n} ` + Array.from({ length: words - 2 }, (_, i) => `w${n}x${i}`).join(' ') + '.'

test('produces ids, indexes and page ranges', () => {
  const pages = [1, 2, 3].map(page => ({
    page,
    text: Array.from({ length: 10 }, (_, i) => sentence(page * 100 + i)).join(' ')
  }))
  const chunks = chunkPages(pages, { docId: 'd1', docName: 'a.pdf' })
  assert.ok(chunks.length >= 2)
  chunks.forEach((c, i) => {
    assert.equal(c.id, `d1#${i}`)
    assert.equal(c.index, i)
    assert.equal(c.docName, 'a.pdf')
    assert.ok(c.pageStart >= 1 && c.pageEnd <= 3 && c.pageStart <= c.pageEnd)
  })
  assert.equal(chunks[0].pageStart, 1)
  assert.equal(chunks.at(-1).pageEnd, 3)
})

test('chunks overlap by whole sentences and bodies cover the text exactly once', () => {
  const text = Array.from({ length: 60 }, (_, i) => sentence(i)).join(' ')
  const chunks = chunkPages([{ page: 1, text }], { docId: 'd', docName: 'x' })
  assert.ok(chunks.length > 2)
  assert.equal(chunks[0].bodyStart, 0)
  for (const c of chunks.slice(1)) {
    assert.ok(c.bodyStart > 0, 'later chunks start with overlap')
    assert.match(c.text.slice(0, c.bodyStart), /\.\s$/, 'overlap ends at a sentence boundary')
  }
  assert.equal(chunks.map(chunkBody).join(' '), text)
})

test('splits very long unpunctuated runs', () => {
  const text = Array.from({ length: 900 }, (_, i) => `word${i}`).join(' ')
  const chunks = chunkPages([{ page: null, text }], { docId: 'd', docName: 'x.txt' })
  assert.ok(chunks.length >= 4)
  assert.equal(chunks[0].pageStart, null)
  for (const c of chunks) assert.ok(c.text.split(' ').length <= 260)
})

test('handles Arabic sentence punctuation', () => {
  const text = Array.from({ length: 40 }, (_, i) => `هذه جملة رقم ${i} عن موضوع مختلف تماما في الوثيقة؟`).join(' ')
  const chunks = chunkPages([{ page: 4, text }], { docId: 'd', docName: 'ar.pdf' })
  assert.ok(chunks.length >= 2)
  assert.ok(chunks.every(c => c.pageStart === 4))
})

test('empty input yields no chunks', () => {
  assert.deepEqual(chunkPages([{ page: 1, text: '   ' }], { docId: 'd', docName: 'x' }), [])
})
