// Splits page text into overlapping, sentence-aligned chunks that remember their pages.

const TARGET_SIZE = 200 // ~words per chunk (keeps chunks under the embedder's 512-token window)
const OVERLAP_SIZE = 35 // ~words repeated from the previous chunk
const MAX_SENTENCE_SIZE = 120

const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter
  ? new Intl.Segmenter(undefined, { granularity: 'sentence' })
  : null

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu

function splitSentences(text) {
  if (segmenter) return [...segmenter.segment(text)].map(s => s.segment.trim()).filter(Boolean)
  return (text.match(/[^.!?؟。]+[.!?؟。]+["')\]]*\s*|[^.!?؟。]+$/g) || []).map(s => s.trim()).filter(Boolean)
}

// "Size" approximates words; CJK characters count as roughly half a word each.
function sizeOf(text) {
  const words = text.split(/\s+/).filter(Boolean).length
  const cjk = text.match(CJK)?.length || 0
  return words + Math.ceil(cjk * 0.6)
}

// Very long "sentences" (tables, lists without punctuation) are cut into word windows.
function splitLong(sentence) {
  if (sizeOf(sentence) <= MAX_SENTENCE_SIZE) return [sentence]
  const words = sentence.split(/\s+/)
  if (words.length > MAX_SENTENCE_SIZE) {
    const pieces = []
    for (let i = 0; i < words.length; i += 100) pieces.push(words.slice(i, i + 100).join(' '))
    return pieces
  }
  const pieces = []
  for (let i = 0; i < sentence.length; i += 160) pieces.push(sentence.slice(i, i + 160))
  return pieces
}

/**
 * @param {{page: number|null, text: string}[]} pages
 * @returns chunks: {id, docId, docName, index, text, bodyStart, pageStart, pageEnd}
 *   `bodyStart` is the offset where text not shared with the previous chunk begins.
 */
export function chunkPages(pages, { docId, docName }) {
  const sentences = []
  for (const { page, text } of pages) {
    for (const paragraph of text.split(/\n\s*\n/)) {
      const clean = paragraph.replace(/\s+/g, ' ').trim()
      if (!clean) continue
      for (const sentence of splitSentences(clean)) {
        for (const piece of splitLong(sentence)) sentences.push({ text: piece, page, size: sizeOf(piece) })
      }
    }
  }

  const chunks = []
  let current = []
  let currentSize = 0
  let overlapCount = 0

  const flush = () => {
    if (current.length <= overlapCount) return
    const overlapText = current.slice(0, overlapCount).map(s => s.text).join(' ')
    const body = current.slice(overlapCount)
    const pagesInBody = body.map(s => s.page).filter(p => p !== null)
    chunks.push({
      id: `${docId}#${chunks.length}`,
      docId,
      docName,
      index: chunks.length,
      text: current.map(s => s.text).join(' '),
      bodyStart: overlapText ? overlapText.length + 1 : 0,
      pageStart: pagesInBody.length ? Math.min(...pagesInBody) : null,
      pageEnd: pagesInBody.length ? Math.max(...pagesInBody) : null
    })
  }

  for (const sentence of sentences) {
    if (currentSize + sentence.size > TARGET_SIZE && current.length > overlapCount) {
      flush()
      const carry = []
      let carrySize = 0
      for (let i = current.length - 1; i > 0; i--) {
        if (carrySize + current[i].size > OVERLAP_SIZE) break
        carry.unshift(current[i])
        carrySize += current[i].size
      }
      current = carry
      currentSize = carrySize
      overlapCount = carry.length
    }
    current.push(sentence)
    currentSize += sentence.size
  }
  flush()

  return chunks
}

/** The part of a chunk that isn't repeated from the previous chunk. */
export const chunkBody = chunk => chunk.text.slice(chunk.bodyStart)
