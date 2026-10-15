// Retrieval benchmark: runs the app's own extraction, chunking and retrieval code in Node and
// measures how often the passage containing each answer is among the excerpts sent to the model.
//
//   npm run eval            (first run downloads the embedding model, ~135 MB)
//
// Corpus: eval/fixtures (a synthetic 12-page employee handbook + a 28-page distractor document).
// Questions: eval/questions.json, many phrased without the handbook's wording, some in Arabic.

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { pipeline } from '@huggingface/transformers'
import { itemsToLines, joinLines, stripRepeatedLines } from '../src/lib/pdfText.js'
import { chunkPages } from '../src/lib/chunker.js'
import { Library } from '../src/lib/library.js'
import { retrieve, vectorSearch } from '../src/lib/retrieval.js'
import { EMBED_MODEL } from '../src/lib/config.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const K = 6

async function readPdf(path) {
  const pdf = await getDocument({ data: new Uint8Array(readFileSync(path)), verbosity: 0 }).promise
  const raw = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    raw.push({ page: i, lines: itemsToLines((await page.getTextContent()).items) })
  }
  return stripRepeatedLines(raw).map(p => ({ page: p.page, text: joinLines(p.lines) })).filter(p => p.text)
}

// The retrieval TalkToPDF shipped with before this upgrade, reproduced for comparison.
function originalTfidf(chunks) {
  const tokenize = text => text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length > 1)
  const vocab = new Map()
  for (const c of chunks) for (const t of tokenize(c.text)) if (!vocab.has(t)) vocab.set(t, vocab.size)
  const df = new Map()
  for (const c of chunks) for (const t of new Set(tokenize(c.text))) df.set(t, (df.get(t) || 0) + 1)
  const idf = new Map([...vocab.keys()].map(t => [t, Math.log((chunks.length + 1) / ((df.get(t) || 0) + 1)) + 1]))
  const vectorize = text => {
    const tokens = tokenize(text)
    const vec = new Float32Array(vocab.size)
    const tf = new Map()
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1)
    for (const [t, n] of tf) if (vocab.has(t)) vec[vocab.get(t)] = (n / tokens.length) * idf.get(t)
    return vec
  }
  const cosine = (a, b) => {
    let dot = 0, na = 0, nb = 0
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
    return na && nb ? dot / Math.sqrt(na * nb) : 0
  }
  const vectors = chunks.map(c => vectorize(c.text))
  return query => {
    const q = vectorize(query)
    const hits = chunks.map((c, i) => ({ c, s: cosine(q, vectors[i]) })).filter(h => h.s > 0.01).sort((a, b) => b.s - a.s)
    return (hits.length ? hits.map(h => h.c) : chunks).slice(0, K)
  }
}

function score(rankings, questions) {
  let r1 = 0, r3 = 0, rk = 0, mrr = 0
  rankings.forEach((texts, i) => {
    const needle = questions[i].answer.toLowerCase()
    const rank = texts.findIndex(t => t.toLowerCase().includes(needle))
    if (rank === 0) r1++
    if (rank >= 0 && rank < 3) r3++
    if (rank >= 0 && rank < K) { rk++; mrr += 1 / (rank + 1) }
  })
  const pct = n => `${Math.round(100 * n / rankings.length)}%`
  return { r1: pct(r1), r3: pct(r3), rk: pct(rk), mrr: (mrr / rankings.length).toFixed(2), hits: rk }
}

const questions = JSON.parse(readFileSync(join(root, 'eval/questions.json'), 'utf8'))
const library = new Library()
for (const file of readdirSync(join(root, 'eval/fixtures')).filter(f => f.endsWith('.pdf'))) {
  const chunks = chunkPages(await readPdf(join(root, 'eval/fixtures', file)), { docId: file, docName: file })
  library.addDocument(file, chunks)
}
const chunks = library.allChunks()
console.log(`Corpus: ${library.docIds().length} documents, ${chunks.length} chunks. Questions: ${questions.length}.`)

console.log(`Embedding with ${EMBED_MODEL}…`)
const extractor = await pipeline('feature-extraction', EMBED_MODEL, { dtype: 'q8' })
const embed = async (texts, prefix) => {
  const out = await extractor(texts.map(t => prefix + t), { pooling: 'mean', normalize: true })
  const dim = out.dims[1]
  return texts.map((_, i) => out.data.slice(i * dim, (i + 1) * dim))
}
for (let i = 0; i < chunks.length; i += 8) {
  const batch = chunks.slice(i, i + 8)
  const vectors = await embed(batch.map(c => c.text), 'passage: ')
  batch.forEach((c, j) => library.setVector(c.id, vectors[j]))
}
const queryVecs = []
for (const q of questions) queryVecs.push((await embed([q.question], 'query: '))[0])

const tfidf = originalTfidf(chunks)
const methods = {
  'Original TF-IDF': questions.map(q => tfidf(q.question).map(c => c.text)),
  'BM25 only': questions.map(q => retrieve(library, { query: q.question }).sources.map(s => s.text)),
  'Semantic only': questions.map((q, i) => vectorSearch(chunks, queryVecs[i], K).map(h => library.get(h.id).text)),
  'Hybrid (shipped)': questions.map((q, i) => retrieve(library, { query: q.question, queryVec: queryVecs[i] }).sources.map(s => s.text))
}

const english = questions.map((q, i) => (q.lang ? -1 : i)).filter(i => i >= 0)
const arabic = questions.map((q, i) => (q.lang === 'ar' ? i : -1)).filter(i => i >= 0)

console.log(`\n| Method | Recall@1 | Recall@3 | Recall@${K} | MRR | English (${english.length}) | Arabic → English (${arabic.length}) |`)
console.log('|---|---|---|---|---|---|---|')
for (const [name, rankings] of Object.entries(methods)) {
  const all = score(rankings, questions)
  const en = score(english.map(i => rankings[i]), english.map(i => questions[i]))
  const ar = score(arabic.map(i => rankings[i]), arabic.map(i => questions[i]))
  console.log(`| ${name} | ${all.r1} | ${all.r3} | ${all.rk} | ${all.mrr} | ${en.hits}/${english.length} | ${ar.hits}/${arabic.length} |`)
}

const misses = methods['Hybrid (shipped)']
  .map((texts, i) => (texts.slice(0, K).some(t => t.toLowerCase().includes(questions[i].answer.toLowerCase())) ? null : questions[i].question))
  .filter(Boolean)
if (misses.length) console.log(`\nHybrid misses: ${misses.join(' · ')}`)
