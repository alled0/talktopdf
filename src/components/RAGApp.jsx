import { useState, useCallback, useEffect, useRef } from 'react'
import Sidebar from './Sidebar.jsx'
import ChatArea from './ChatArea.jsx'
import SettingsPanel from './SettingsPanel.jsx'
import SemanticStatus from './SemanticStatus.jsx'
import SourcePanel from './SourcePanel.jsx'
import { useEmbedState, useLibrary } from '../hooks/useLibrary.js'
import { embedQuery } from '../lib/embeddings.js'
import { coverageSelect, retrieve } from '../lib/retrieval.js'
import { isBroadQuestion } from '../lib/query.js'
import { rewriteQuery, streamAnswer, suggestQuestions } from '../lib/llm.js'
import { EMBED_MODEL_SIZE_MB, FREE_DAILY_ANSWERS } from '../lib/config.js'
import { readStorage, writeStorage } from '../lib/storage.js'

const KEY_STORAGE = 'talktopdf_groq_key'
const SEMANTIC_STORAGE = 'talktopdf_semantic'
const freeStorageKey = () => `talktopdf_free_remaining_${new Date().toISOString().slice(0, 10)}`

// Semantic search downloads a model once; skip it by default on data-saver connections.
const defaultSemantic = () => (navigator.connection?.saveData ? 'off' : 'on')

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

export default function RAGApp() {
  const [error, setError] = useState(null)
  const [apiKey, setApiKey] = useState(() => readStorage(KEY_STORAGE, ''))
  const [semanticEnabled, setSemanticEnabled] = useState(() => readStorage(SEMANTIC_STORAGE, defaultSemantic()) === 'on')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [isThinking, setIsThinking] = useState(false)
  const [activeSource, setActiveSource] = useState(null) // { messageId, n }
  const [suggestions, setSuggestions] = useState({ key: '', questions: [] })
  const [freeRemaining, setFreeRemaining] = useState(() =>
    Number(readStorage(freeStorageKey(), FREE_DAILY_ANSWERS))
  )
  const abortRef = useRef(null)
  const apiKeyRef = useRef(apiKey)

  const embedState = useEmbedState()
  const { library, docs, stats, addFiles, removeDoc } = useLibrary({ semanticEnabled, onError: setError })
  const usageLimitReached = !apiKey && freeRemaining <= 0
  const readyDocs = docs.filter(d => d.status === 'ready')
  const libraryKey = readyDocs.map(d => d.id).join('|')

  useEffect(() => {
    apiKeyRef.current = apiKey
    writeStorage(KEY_STORAGE, apiKey || null)
  }, [apiKey])
  useEffect(() => { writeStorage(SEMANTIC_STORAGE, semanticEnabled ? 'on' : 'off') }, [semanticEnabled])

  const updateFreeRemaining = useCallback((remaining) => {
    if (remaining === null || Number.isNaN(remaining)) return
    setFreeRemaining(remaining)
    writeStorage(freeStorageKey(), String(remaining))
  }, [])

  // Starter questions written from a sample of the documents, refreshed when the library changes.
  const conversationStarted = messages.length > 0
  const processing = docs.some(d => d.status === 'reading')
  useEffect(() => {
    if (!libraryKey || conversationStarted || processing) return
    let cancelled = false
    const timer = setTimeout(async () => {
      const ids = coverageSelect(library, { budget: 4500 })
      const excerpts = ids.map(id => library.get(id).text).join('\n\n').slice(0, 5500)
      const questions = await suggestQuestions({ apiKey: apiKeyRef.current, excerpts })
      if (!cancelled && questions.length) setSuggestions({ key: libraryKey, questions })
    }, 400)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [libraryKey, conversationStarted, processing, library])

  const handleFilesAdded = useCallback((files) => {
    setSidebarOpen(false)
    addFiles(files)
  }, [addFiles])

  const ask = useCallback(async (question, history) => {
    const answerId = newId()
    setMessages(prev => [
      ...prev,
      { id: newId(), role: 'user', content: question },
      { id: answerId, role: 'assistant', content: '', status: 'searching', sources: [] }
    ])
    const patch = fields => setMessages(prev => prev.map(m => (m.id === answerId ? { ...m, ...fields } : m)))
    const controller = new AbortController()
    abortRef.current = controller
    setIsThinking(true)

    try {
      // Follow-ups ("what about the second one?") are rewritten into standalone search queries.
      let query = question
      let scope = isBroadQuestion(question) ? 'broad' : 'specific'
      if (history.length) {
        const rewritten = await rewriteQuery({ apiKey, question, history, signal: controller.signal })
        if (rewritten) {
          query = rewritten.query
          if (rewritten.scope === 'broad') scope = 'broad'
        } else {
          const previous = history.filter(m => m.role === 'user').at(-1)
          if (previous) query = `${previous.content} ${question}`
        }
      }

      const queryVec = semanticEnabled ? await embedQuery(query) : null
      const result = retrieve(library, { query, queryVec, scope })
      patch({ status: 'streaming', query, sources: result.sources, mode: result.mode, lowConfidence: result.lowConfidence })

      const { remaining } = await streamAnswer({
        apiKey,
        question,
        history,
        sources: result.sources,
        scope,
        signal: controller.signal,
        onText: content => patch({ content })
      })
      patch({ status: 'done' })
      updateFreeRemaining(remaining)
    } catch (err) {
      if (err.name === 'AbortError') {
        patch({ status: 'stopped' })
      } else {
        if (err.limitReached) updateFreeRemaining(0)
        patch({ status: 'error', error: err.message })
      }
    } finally {
      abortRef.current = null
      setIsThinking(false)
    }
  }, [apiKey, library, semanticEnabled, updateFreeRemaining])

  // Earlier turns sent as conversation context (failed answers are left out).
  const historyOf = msgs => msgs
    .filter(m => m.content && m.status !== 'error')
    .map(m => ({ role: m.role, content: m.content }))

  const handleSendMessage = useCallback((question) => {
    if (!question.trim() || isThinking || usageLimitReached || library.size === 0) return
    ask(question, historyOf(messages))
  }, [ask, isThinking, usageLimitReached, library, messages])

  const handleRetry = useCallback((answerId) => {
    if (isThinking) return
    const index = messages.findIndex(m => m.id === answerId)
    const question = messages[index - 1]
    if (index < 1 || question?.role !== 'user') return
    const earlier = messages.slice(0, index - 1)
    setMessages(earlier)
    ask(question.content, historyOf(earlier))
  }, [ask, isThinking, messages])

  const handleStop = useCallback(() => abortRef.current?.abort(), [])

  const handleNewChat = useCallback(() => {
    abortRef.current?.abort()
    setMessages([])
    setActiveSource(null)
  }, [])

  const openSource = useCallback((messageId, n) => setActiveSource({ messageId, n }), [])
  const closeSource = useCallback(() => setActiveSource(null), [])
  const selectSource = useCallback(n => setActiveSource(s => (s ? { ...s, n } : s)), [])
  const sourceMessage = activeSource && messages.find(m => m.id === activeSource.messageId)

  const closeSettings = useCallback(() => setSettingsOpen(false), [])

  return (
    <div className="flex h-screen overflow-hidden bg-bg font-mono">
      {error && (
        <div role="alert"
          className="fixed top-4 right-4 z-[60] flex items-start gap-3 p-4 rounded-lg shadow-lg max-w-sm fade-in bg-[#2d1a1a] border border-[#8b3030] text-danger">
          <span className="flex-1 text-sm">{error}</span>
          <button onClick={() => setError(null)} aria-label="Dismiss" className="text-danger/70 hover:text-danger text-lg leading-none">&times;</button>
        </div>
      )}

      {sidebarOpen && (
        <div className="fixed inset-0 z-30 md:hidden bg-black/60" onClick={() => setSidebarOpen(false)} />
      )}

      <Sidebar
        docs={docs}
        stats={stats}
        onFilesAdded={handleFilesAdded}
        onRemoveDoc={removeDoc}
        sidebarOpen={sidebarOpen}
        onCloseSidebar={() => setSidebarOpen(false)}
        semanticEnabled={semanticEnabled}
        embedState={embedState}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <ChatArea
        messages={messages}
        isThinking={isThinking}
        onSendMessage={handleSendMessage}
        onStop={handleStop}
        onRetry={handleRetry}
        onOpenSource={openSource}
        onNewChat={handleNewChat}
        apiKey={apiKey}
        hasDocuments={stats.chunks > 0}
        docCount={readyDocs.length}
        usageLimitReached={usageLimitReached}
        freeRemaining={freeRemaining}
        freeLimit={FREE_DAILY_ANSWERS}
        suggestions={suggestions.key === libraryKey ? suggestions.questions : null}
        onToggleSidebar={() => setSidebarOpen(s => !s)}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {sourceMessage && (
        <SourcePanel message={sourceMessage} activeN={activeSource.n} onSelect={selectSource} onClose={closeSource} />
      )}

      {settingsOpen && (
        <SettingsPanel
          onClose={closeSettings}
          apiKey={apiKey}
          onApiKeyChange={setApiKey}
          freeRemaining={freeRemaining}
          freeLimit={FREE_DAILY_ANSWERS}
        >
          <div className="px-5 py-4 border-t border-line space-y-2">
            <label className="flex items-start justify-between gap-4 cursor-pointer">
              <span>
                <span className="block text-sm text-ink">Semantic search</span>
                <span className="block text-xs leading-relaxed text-muted mt-1">
                  Finds passages by meaning, across languages. Runs entirely in your browser using a
                  ~{EMBED_MODEL_SIZE_MB} MB model that downloads once.
                </span>
              </span>
              <input
                type="checkbox"
                role="switch"
                checked={semanticEnabled}
                onChange={e => setSemanticEnabled(e.target.checked)}
                className="mt-1 h-4 w-4 accent-[rgb(var(--accent))]"
              />
            </label>
            <SemanticStatus enabled={semanticEnabled} state={embedState} />
          </div>
        </SettingsPanel>
      )}
    </div>
  )
}
