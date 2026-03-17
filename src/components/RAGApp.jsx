import { useState, useCallback, useMemo } from 'react'
import Sidebar from './Sidebar.jsx'
import ChatArea from './ChatArea.jsx'
import { extractFile } from '../lib/pdfParser.js'
import { chunkText } from '../lib/chunker.js'
import { buildVocab, buildIDF, tfidf, retrieve } from '../lib/tfidf.js'
import { askLLM, buildSystemPrompt } from '../lib/llm.js'

export default function RAGApp() {
  const [docs, setDocs] = useState([])
  const [chunks, setChunks] = useState([])
  const [vocab, setVocab] = useState(new Map())
  const [idf, setIdf] = useState(new Map())
  const [messages, setMessages] = useState([])
  const [isThinking, setIsThinking] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState(null)

  const FREE_LIMIT = 10
  const usageKey = useMemo(() => `talktopdf_usage_${new Date().toISOString().slice(0, 10)}`, [])
  const [proxyUsage, setProxyUsage] = useState(() =>
    parseInt(localStorage.getItem(`talktopdf_usage_${new Date().toISOString().slice(0, 10)}`) || '0', 10)
  )
  const usageLimitReached = !apiKey && proxyUsage >= FREE_LIMIT

  const rebuildIndex = useCallback((allChunks) => {
    if (allChunks.length === 0) {
      setVocab(new Map())
      setIdf(new Map())
      return []
    }

    const newVocab = buildVocab(allChunks)
    const newIdf = buildIDF(allChunks, newVocab)

    const vectorizedChunks = allChunks.map(chunk => ({
      ...chunk,
      vec: tfidf(chunk.text, newVocab, newIdf)
    }))

    setVocab(newVocab)
    setIdf(newIdf)
    return vectorizedChunks
  }, [])

  const handleFilesAdded = useCallback(async (files) => {
    for (const file of files) {
      const docId = `${file.name}-${Date.now()}`

      setDocs(prev => [...prev, {
        id: docId,
        name: file.name,
        size: file.size,
        status: 'processing',
        chunkCount: 0
      }])

      try {
        const text = await extractFile(file)
        const docChunks = chunkText(text, file.name)

        setChunks(prev => {
          const allChunks = [...prev, ...docChunks]
          const vectorized = rebuildIndex(allChunks)
          return vectorized
        })

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
    const docToRemove = docs.find(d => d.id === docId)
    if (!docToRemove) return

    setDocs(prev => prev.filter(d => d.id !== docId))
    setChunks(prev => {
      const remaining = prev.filter(c => c.doc !== docToRemove.name)
      const vectorized = rebuildIndex(remaining)
      return vectorized
    })
  }, [docs, rebuildIndex])

  const handleSendMessage = useCallback(async (userText) => {
    if (!userText.trim() || isThinking || usageLimitReached) return

    const userMsg = { role: 'user', content: userText }
    setMessages(prev => [...prev, userMsg])
    setIsThinking(true)

    try {
      let responseText
      let citations = []

      if (chunks.length > 0) {
        console.log('all chunks:', chunks)
        const queryVec = tfidf(userText, vocab, idf)
        console.log('query vec:', queryVec)
        const retrieved = retrieve(queryVec, chunks, 6, 0.01)
        console.log('retrieved:', retrieved)

        citations = retrieved.map(chunk => ({
          doc: chunk.doc.replace(/\.[^.]+$/, ''),
          chunk: chunk.chunk
        }))

        const systemPrompt = buildSystemPrompt(retrieved)
        console.log('systemPrompt:', systemPrompt)
        const history = [...messages, userMsg]
        responseText = await askLLM(apiKey, 'llama-3.3-70b-versatile', history, systemPrompt)
      } else {
        responseText = "Please upload some documents first so I can answer questions based on their content."
      }

      if (!apiKey) {
        const next = proxyUsage + 1
        localStorage.setItem(usageKey, String(next))
        setProxyUsage(next)
      }

      const assistantMsg = {
        role: 'assistant',
        content: responseText,
        citations
      }
      setMessages(prev => [...prev, assistantMsg])
    } catch (err) {
      setError(`API Error: ${err.message}`)
    } finally {
      setIsThinking(false)
    }
  }, [apiKey, chunks, vocab, idf, messages, isThinking, usageLimitReached, proxyUsage, usageKey])

  const totalWords = chunks.reduce((sum, c) => sum + c.text.split(/\s+/).length, 0)
  const estimatedTokens = Math.round(totalWords * 1.3)

  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: '#0e0f11', fontFamily: "'DM Mono', monospace" }}>
      {error && (
        <div className="fixed top-4 right-4 z-50 flex items-start gap-3 p-4 rounded-lg shadow-lg max-w-sm fade-in"
          style={{ backgroundColor: '#2d1a1a', border: '1px solid #8b3030', color: '#fca5a5' }}>
          <span className="flex-1 text-sm">{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-200 text-lg leading-none">&times;</button>
        </div>
      )}

      <Sidebar
        docs={docs}
        onFilesAdded={handleFilesAdded}
        onRemoveDoc={handleRemoveDoc}
        totalDocs={docs.length}
        totalChunks={chunks.length}
        estimatedTokens={estimatedTokens}
      />

      <ChatArea
        messages={messages}
        isThinking={isThinking}
        onSendMessage={handleSendMessage}
        apiKey={apiKey}
        onApiKeyChange={setApiKey}
        hasDocuments={docs.length > 0}
        usageLimitReached={usageLimitReached}
        proxyUsage={proxyUsage}
        freeLimit={FREE_LIMIT}
      />
    </div>
  )
}
