import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Library } from '../lib/library.js'
import { extractFile } from '../lib/pdfParser.js'
import { chunkPages } from '../lib/chunker.js'
import { embedPassages, getEmbedState, resetEmbedder, subscribeEmbedState } from '../lib/embeddings.js'
import { estimateTokens } from '../lib/text.js'

const EMBED_BATCH = 4

export function useEmbedState() {
  return useSyncExternalStore(subscribeEmbedState, getEmbedState)
}

const newDocId = () => `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

/**
 * Owns the document library: parsing, chunking, keyword indexing and background embedding.
 * `docs` is the UI-facing list; `library` holds chunks/vectors and is mutated in place
 * (`revision` changes whenever its contents do).
 */
export function useLibrary({ semanticEnabled, onError }) {
  const [library] = useState(() => new Library())
  const [docs, setDocs] = useState([])
  const [revision, setRevision] = useState(0)
  const removedRef = useRef(new Set())
  const embeddingRef = useRef(false)
  const semanticRef = useRef(semanticEnabled)

  const bump = useCallback(() => setRevision(r => r + 1), [])
  const patchDoc = useCallback((id, patch) => {
    setDocs(prev => prev.map(d => (d.id === id ? { ...d, ...patch } : d)))
  }, [])

  // Embeds every chunk that has no vector yet, one small batch at a time.
  const embedPending = useCallback(async () => {
    if (embeddingRef.current) return
    embeddingRef.current = true
    try {
      while (semanticRef.current && getEmbedState().status !== 'error') {
        const docId = library.docIds().find(id => library.chunksOf(id).some(c => !c.vec))
        if (!docId) break
        const chunks = library.chunksOf(docId)
        const batch = chunks.filter(c => !c.vec).slice(0, EMBED_BATCH)
        const vectors = await embedPassages(batch.map(c => c.text))
        if (!library.hasDocument(docId)) continue
        batch.forEach((chunk, i) => library.setVector(chunk.id, vectors[i]))
        const embedded = chunks.filter(c => c.vec).length
        patchDoc(docId, { embedded })
        if (embedded === chunks.length) bump()
      }
    } catch {
      // The model failed to load or run; keyword search keeps working and the status is shown.
    } finally {
      embeddingRef.current = false
    }
  }, [library, patchDoc, bump])

  useEffect(() => {
    semanticRef.current = semanticEnabled
    if (semanticEnabled) {
      if (getEmbedState().status === 'error') resetEmbedder()
      if (library.size) embedPending()
    }
  }, [semanticEnabled, library, embedPending])

  const addFiles = useCallback(async (files) => {
    for (const file of files) {
      const id = newDocId()
      setDocs(prev => [...prev, {
        id,
        name: file.name,
        size: file.size,
        status: 'reading',
        progress: 0,
        pageCount: null,
        emptyPages: 0,
        chunkCount: 0,
        embedded: 0
      }])

      try {
        const { pages, pageCount, emptyPages } = await extractFile(file, {
          onProgress: ({ page, total }) => patchDoc(id, { progress: page / total })
        })
        if (removedRef.current.has(id)) continue
        const chunks = chunkPages(pages, { docId: id, docName: file.name })
        if (!chunks.length) throw new Error('No readable text found.')

        library.addDocument(id, chunks)
        patchDoc(id, { status: 'ready', progress: 1, pageCount, emptyPages, chunkCount: chunks.length })
        bump()
        if (semanticRef.current) embedPending()
      } catch (err) {
        onError?.(`Couldn't read "${file.name}": ${err.message}`)
        setDocs(prev => prev.filter(d => d.id !== id))
      }
    }
  }, [library, patchDoc, bump, embedPending, onError])

  const removeDoc = useCallback((id) => {
    removedRef.current.add(id)
    library.removeDocument(id)
    setDocs(prev => prev.filter(d => d.id !== id))
    bump()
  }, [library, bump])

  const stats = useMemo(() => {
    let tokens = 0
    for (const chunk of library.allChunks()) tokens += estimateTokens(chunk.text.slice(chunk.bodyStart))
    return { chunks: library.size, tokens }
    // `revision` tracks in-place library changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library, revision])

  return { library, docs, revision, stats, addFiles, removeDoc }
}
