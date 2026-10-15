import { useState, useCallback, useEffect, useRef } from 'react'
import Sidebar from './Sidebar.jsx'
import ChatArea from './ChatArea.jsx'
import { extractFile } from '../lib/pdfParser.js'
import { chunkText } from '../lib/chunker.js'
import { buildVocab, buildIDF, tfidf, retrieve } from '../lib/tfidf.js'
import { streamAnswer } from '../lib/llm.js'
import { FREE_DAILY_ANSWERS } from '../lib/config.js'

const KEY_STORAGE = 'talktopdf_groq_key'
const freeStorageKey = () => `talktopdf_free_remaining_${new Date().toISOString().slice(0, 10)}`

function readStorage(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback } catch { return fallback }
}

function writeStorage(key, value) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // storage unavailable (private mode); the app still works for this session
  }
}

export default function RAGApp() {
  const [docs, setDocs] = useState([])
  const [chunks, setChunks] = useState([])
  const indexRef = useRef({ vocab: new Map(), idf: new Map(), chunks: [] })
  const removedRef = useRef(new Set())
  const [messages, setMessages] = useState([])
  const [isThinking, setIsThinking] = useState(false)
  const [apiKey, setApiKey] = useState(() => readStorage(KEY_STORAGE, ''))
  const [error, setError] = useState(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [freeRemaining, setFreeRemaining] = useState(() =>
    Number(readStorage(freeStorageKey(), FREE_DAILY_ANSWERS))
  )
  const usageLimitReached = !apiKey && freeRemaining <= 0

  useEffect(() => { writeStorage(KEY_STORAGE, apiKey || null) }, [apiKey])

  const updateFreeRemaining = useCallback((remaining) => {
    if (remaining === null || Number.isNaN(remaining)) return
    setFreeRemaining(remaining)
    writeStorage(freeStorageKey(), String(remaining))
  }, [])

  const rebuildIndex = useCallback((allChunks) => {
    if (allChunks.length === 0) {
      indexRef.current = { vocab: new Map(), idf: new Map(), chunks: [] }
      setChunks([])
      return
    }

    const newVocab = buildVocab(allChunks)
    const newIdf = buildIDF(allChunks, newVocab)

    const vectorizedChunks = allChunks.map(c => ({
      ...c,
      vec: tfidf(c.text, newVocab, newIdf)
    }))

    indexRef.current = { vocab: newVocab, idf: newIdf, chunks: vectorizedChunks }
    setChunks(vectorizedChunks)
  }, [])

  const handleFilesAdded = useCallback(async (files) => {
    setSidebarOpen(false)
    for (const file of files) {
      const docId = `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

      setDocs(prev => [...prev, {
        id: docId,
        name: file.name,
        size: file.size,
        status: 'processing',
        chunkCount: 0
      }])

      try {
        const text = await extractFile(file)
        const docChunks = chunkText(text, file.name, docId)
        if (removedRef.current.has(docId)) continue

        rebuildIndex([...indexRef.current.chunks, ...docChunks])

        setDocs(prev => prev.map(d =>
          d.id === docId
            ? { ...d, status: 'ready', chunkCount: docChunks.length }
            : d
        ))
      } catch (err) {
        setError(`Failed to process "${file.name}": ${err.message}`)
        setDocs(prev => prev.filter(d => d.id !== docId))
      }
    }
  }, [rebuildIndex])

  const handleRemoveDoc = useCallback((docId) => {
    removedRef.current.add(docId)
    setDocs(prev => prev.filter(d => d.id !== docId))
    rebuildIndex(indexRef.current.chunks.filter(c => c.docId !== docId))
  }, [rebuildIndex])

  const handleSendMessage = useCallback(async (userText) => {
    if (!userText.trim() || isThinking || usageLimitReached) return

    const { vocab, idf, chunks: indexedChunks } = indexRef.current
    if (indexedChunks.length === 0) return

    const userMsg = { role: 'user', content: userText }
    const history = messages.filter(m => m.content)
    setMessages(prev => [...prev, userMsg, { role: 'assistant', content: '', citations: [] }])
    setIsThinking(true)

    const setAnswer = (patch) => setMessages(prev => {
      const next = [...prev]
      next[next.length - 1] = { ...next[next.length - 1], ...patch }
      return next
    })

    try {
      const queryVec = tfidf(userText, vocab, idf)
      let retrieved = retrieve(queryVec, indexedChunks, 6, 0.01)
      if (retrieved.length === 0) retrieved = indexedChunks.slice(0, 6)

      const sources = retrieved.map(chunk => ({ label: `${chunk.doc}, chunk ${chunk.chunk}`, text: chunk.text }))
      const citations = retrieved.map(chunk => ({ doc: chunk.doc.replace(/\.[^.]+$/, ''), chunk: chunk.chunk }))

      const { remaining } = await streamAnswer({
        apiKey,
        question: userText,
        history,
        sources,
        scope: 'specific',
        onText: text => setAnswer({ content: text })
      })
      setAnswer({ citations })
      updateFreeRemaining(remaining)
    } catch (err) {
      if (err.limitReached) updateFreeRemaining(0)
      setMessages(prev => prev.slice(0, -1))
      setError(err.message)
    } finally {
      setIsThinking(false)
    }
  }, [apiKey, messages, isThinking, usageLimitReached, updateFreeRemaining])

  const totalWords = chunks.reduce((sum, c) => sum + c.text.split(/\s+/).length, 0)
  const estimatedTokens = Math.round(totalWords * 1.3)

  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: '#0e0f11', fontFamily: "'DM Mono', monospace" }}>
      {error && (
        <div className="fixed top-4 right-4 z-50 flex items-start gap-3 p-4 rounded-lg shadow-lg max-w-sm fade-in"
          role="alert"
          style={{ backgroundColor: '#2d1a1a', border: '1px solid #8b3030', color: '#fca5a5' }}>
          <span className="flex-1 text-sm">{error}</span>
          <button onClick={() => setError(null)} aria-label="Dismiss" className="text-red-400 hover:text-red-200 text-lg leading-none">&times;</button>
        </div>
      )}

      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 md:hidden"
          style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <Sidebar
        docs={docs}
        onFilesAdded={handleFilesAdded}
        onRemoveDoc={handleRemoveDoc}
        totalDocs={docs.length}
        totalChunks={chunks.length}
        estimatedTokens={estimatedTokens}
        sidebarOpen={sidebarOpen}
        onCloseSidebar={() => setSidebarOpen(false)}
      />

      <ChatArea
        messages={messages}
        isThinking={isThinking}
        onSendMessage={handleSendMessage}
        apiKey={apiKey}
        onApiKeyChange={setApiKey}
        hasDocuments={chunks.length > 0}
        usageLimitReached={usageLimitReached}
        freeRemaining={freeRemaining}
        freeLimit={FREE_DAILY_ANSWERS}
        onToggleSidebar={() => setSidebarOpen(s => !s)}
      />
    </div>
  )
}
