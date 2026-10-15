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
import { EMBED_MODEL_SIZE_MB } from '../lib/config.js'
import { readStorage, writeStorage } from '../lib/storage.js'
import { filterSupported } from '../lib/files.js'
import { loadChat, saveChat } from '../lib/db.js'

const KEY_STORAGE = 'talktopdf_groq_key'
const SEMANTIC_STORAGE = 'talktopdf_semantic'
const freeStorageKey = () => `talktopdf_free_remaining_${new Date().toISOString().slice(0, 10)}`

// Semantic search downloads a model once; skip it by default on data-saver connections.
const defaultSemantic = () => (navigator.connection?.saveData ? 'off' : 'on')

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

function PrivacySection({ onClearAll }) {
  const [confirming, setConfirming] = useState(false)
  const [cleared, setCleared] = useState(false)
  return (
    <div className="px-5 py-4 border-t border-line space-y-2">
      <span className="block text-sm text-ink">Privacy</span>
      <p className="text-xs leading-relaxed text-muted">
        Files are parsed and indexed on this device. Your documents, their search index and this
        conversation are saved only in this browser. Questions and the passages used to answer them are
        sent to the AI provider (Groq) to generate answers.
      </p>
      <button
        onClick={async () => {
          if (!confirming) return setConfirming(true)
          await onClearAll()
          setConfirming(false)
          setCleared(true)
        }}
        className={`px-3 py-2 rounded-lg text-xs border transition-colors ${
          confirming ? 'border-danger/60 text-danger bg-danger/10' : 'border-line-strong text-muted hover:text-danger hover:border-danger/40'
        }`}
      >
        {cleared ? 'All local data deleted' : confirming ? 'Click again to delete everything' : 'Delete all documents and chat from this browser'}
      </button>
    </div>
  )
}

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
  // Free questions this visitor has left today, as last reported by the proxy (null = unknown/unlimited).
  const [freeRemaining, setFreeRemaining] = useState(() => {
    const saved = readStorage(freeStorageKey(), null)
    return saved === null ? null : Number(saved)
  })
  const [chatLoaded, setChatLoaded] = useState(false)
  const [dragging, setDragging] = useState(false)
  const abortRef = useRef(null)
  const apiKeyRef = useRef(apiKey)

  const embedState = useEmbedState()
  const { library, docs, stats, addFiles, removeDoc, clearAll } = useLibrary({ semanticEnabled, onError: setError })
  const usageLimitReached = !apiKey && freeRemaining === 0
  const readyDocs = docs.filter(d => d.status === 'ready')
  const libraryKey = readyDocs.map(d => d.id).join('|')

  useEffect(() => {
    apiKeyRef.current = apiKey
    writeStorage(KEY_STORAGE, apiKey || null)
  }, [apiKey])
  useEffect(() => { writeStorage(SEMANTIC_STORAGE, semanticEnabled ? 'on' : 'off') }, [semanticEnabled])

  // Restore the previous conversation, then keep it saved (answers interrupted by a reload are marked stopped).
  useEffect(() => {
    let cancelled = false
    loadChat()
      .then(saved => {
        if (cancelled || !saved.length) return
        setMessages(prev => prev.length ? prev : saved.map(m =>
          m.status === 'searching' || m.status === 'streaming' ? { ...m, status: 'stopped' } : m
        ))
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setChatLoaded(true) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!chatLoaded) return
    const timer = setTimeout(() => saveChat(messages).catch(() => {}), 500)
    return () => clearTimeout(timer)
  }, [messages, chatLoaded])

  useEffect(() => {
    if (!error) return
    const timer = setTimeout(() => setError(null), 8000)
    return () => clearTimeout(timer)
  }, [error])

  // Files can be dropped anywhere on the page.
  useEffect(() => {
    const hasFiles = e => Array.from(e.dataTransfer?.types || []).includes('Files')
    const onDragEnter = e => { if (hasFiles(e)) setDragging(true) }
    window.addEventListener('dragenter', onDragEnter)
    return () => window.removeEventListener('dragenter', onDragEnter)
  }, [])

  const handleWindowDrop = useCallback((e) => {
    e.preventDefault()
    setDragging(false)
    const files = filterSupported(e.dataTransfer.files)
    if (files.length) addFiles(files)
    else if (e.dataTransfer.files.length) setError('Only PDF, TXT and MD files are supported.')
  }, [addFiles])

  const handleClearAll = useCallback(async () => {
    abortRef.current?.abort()
    setMessages([])
    setActiveSource(null)
    await clearAll()
  }, [clearAll])

  const updateFreeRemaining = useCallback((remaining) => {
    const value = remaining === null || Number.isNaN(remaining) ? null : remaining
    setFreeRemaining(value)
    writeStorage(freeStorageKey(), value === null ? null : String(value))
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

      const { remaining, model } = await streamAnswer({
        apiKey,
        question,
        history,
        sources: result.sources,
        scope,
        signal: controller.signal,
        onText: content => patch({ content })
      })
      patch({ status: 'done', model })
      if (!apiKey) updateFreeRemaining(remaining)
    } catch (err) {
      if (err.name === 'AbortError') {
        patch({ status: 'stopped' })
      } else {
        if (err.code === 'limit') updateFreeRemaining(0)
        patch({ status: 'error', error: err.message, needsKey: Boolean(err.needsOwnKey) })
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
          className="fixed top-4 right-4 z-[60] flex items-start gap-3 p-4 rounded-lg shadow-lg max-w-sm fade-in bg-danger-surface border border-danger-line text-danger">
          <span className="flex-1 text-sm">{error}</span>
          <button onClick={() => setError(null)} aria-label="Dismiss" className="text-danger/70 hover:text-danger text-lg leading-none">&times;</button>
        </div>
      )}

      {sidebarOpen && (
        <div className="fixed inset-0 z-30 md:hidden bg-black/60" onClick={() => setSidebarOpen(false)} />
      )}

      {dragging && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-bg/85 backdrop-blur-sm p-6"
          onDragOver={e => e.preventDefault()}
          onDragLeave={e => { if (!e.relatedTarget) setDragging(false) }}
          onDrop={handleWindowDrop}
        >
          <div className="pointer-events-none w-full max-w-lg rounded-2xl border-2 border-dashed border-accent/60 bg-accent/5 px-8 py-14 text-center fade-in">
            <p className="font-serif text-2xl text-accent">Drop to add to your library</p>
            <p className="text-sm text-muted mt-2">PDF, TXT or Markdown · processed privately in your browser</p>
          </div>
        </div>
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
          <PrivacySection onClearAll={handleClearAll} />
        </SettingsPanel>
      )}
    </div>
  )
}
