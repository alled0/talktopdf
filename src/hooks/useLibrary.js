import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Library } from '../lib/library.js'
import { chunkPages } from '../lib/chunker.js'
import { embedPassages, getEmbedState, resetEmbedder, subscribeEmbedState, warmUpEmbedder } from '../lib/embeddings.js'
import { estimateTokens } from '../lib/text.js'
import * as db from '../lib/db.js'

const EMBED_BATCH = 4

export function useEmbedState() {
  return useSyncExternalStore(subscribeEmbedState, getEmbedState)
}

const newDocId = () => `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
const persist = promise => promise.catch(() => {}) // storage is best effort (private mode, quota)

/**
 * Owns the document library: parsing, chunking, keyword indexing, background embedding and
 * persistence. `docs` is the UI-facing list; `library` holds chunks/vectors and is mutated in
 * place (`revision` changes whenever its contents do).
 */
export function useLibrary({ semanticEnabled, onError }) {
  const [library] = useState(() => new Library())
  const [docs, setDocs] = useState([])
  const [revision, setRevision] = useState(0)
  const [restored, setRestored] = useState(false)
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
        if (embedded === chunks.length) {
          bump()
          persist(db.saveChunks(chunks))
        }
      }
    } catch {
      // The model failed to load or run; keyword search keeps working and the status is shown.
    } finally {
      embeddingRef.current = false
    }
  }, [library, patchDoc, bump])

  // Restore the library saved in this browser.
  useEffect(() => {
    let cancelled = false
    db.loadLibrary()
      .then(saved => {
        if (cancelled || !saved.length) return
        for (const { doc, chunks } of saved) library.addDocument(doc.id, chunks)
        const restoredDocs = saved.map(({ doc, chunks }) => ({
          ...doc,
          status: 'ready',
          progress: 1,
          embedded: chunks.filter(c => c.vec).length
        }))
        // Keep any upload the user started while the saved library was loading.
        setDocs(prev => [...restoredDocs, ...prev.filter(d => !restoredDocs.some(r => r.id === d.id))])
        bump()
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setRestored(true) })
    return () => { cancelled = true }
  }, [library, bump])

  useEffect(() => {
    semanticRef.current = semanticEnabled
    if (semanticEnabled && restored) {
      if (getEmbedState().status === 'error') resetEmbedder()
      if (library.size) {
        warmUpEmbedder() // restored vectors still need the model to embed questions
        // Starts background work; it only updates state after awaiting the worker.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        embedPending()
      }
    }
  }, [semanticEnabled, restored, library, embedPending])

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
        const { extractFile } = await import('../lib/pdfParser.js')
        const { pages, pageCount, emptyPages } = await extractFile(file, {
          onProgress: ({ page, total }) => patchDoc(id, { progress: page / total })
        })
        if (removedRef.current.has(id)) continue
        const chunks = chunkPages(pages, { docId: id, docName: file.name })
        if (!chunks.length) throw new Error('No readable text found.')

        library.addDocument(id, chunks)
        const meta = { id, name: file.name, size: file.size, pageCount, emptyPages, chunkCount: chunks.length, addedAt: Date.now() }
        patchDoc(id, { ...meta, status: 'ready', progress: 1 })
        bump()
        persist(db.saveDocument(meta, chunks))
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
    persist(db.deleteDocument(id))
  }, [library, bump])

  /** Removes every document and the saved conversation from this browser. */
  const clearAll = useCallback(async () => {
    for (const id of library.docIds()) {
      removedRef.current.add(id)
      library.removeDocument(id)
    }
    setDocs([])
    bump()
    await persist(db.clearAll())
  }, [library, bump])

  const stats = useMemo(() => {
    let tokens = 0
    for (const chunk of library.allChunks()) tokens += estimateTokens(chunk.text.slice(chunk.bodyStart))
    return { chunks: library.size, tokens }
    // `revision` tracks in-place library changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library, revision])

  return { library, docs, stats, restored, addFiles, removeDoc, clearAll }
}
