export function chunkText(text, docName) {
  const TARGET = 300
  const OVERLAP = 50

  const words = text.split(/\s+/).filter(w => w.length > 0)
  if (words.length === 0) return []

  const chunks = []
  let start = 0
  let idx = 0

  while (start < words.length) {
    const end = Math.min(start + TARGET, words.length)
    const slice = words.slice(start, end).join(' ')

    if (slice.trim()) chunks.push({ text: slice, doc: docName, chunk: idx++, vec: null })

    if (end >= words.length) break
    start = end - OVERLAP
  }

  return chunks
}
