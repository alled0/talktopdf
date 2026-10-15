import { useState, useCallback, useEffect } from 'react'
import Sidebar from './Sidebar.jsx'
import ChatArea from './ChatArea.jsx'
import SettingsPanel from './SettingsPanel.jsx'
import SemanticStatus from './SemanticStatus.jsx'
import { useEmbedState, useLibrary } from '../hooks/useLibrary.js'
import { embedQuery } from '../lib/embeddings.js'
import { retrieve } from '../lib/retrieval.js'
import { isBroadQuestion } from '../lib/query.js'
import { streamAnswer } from '../lib/llm.js'
import { EMBED_MODEL_SIZE_MB, FREE_DAILY_ANSWERS } from '../lib/config.js'
import { readStorage, writeStorage } from '../lib/storage.js'

const KEY_STORAGE = 'talktopdf_groq_key'
const SEMANTIC_STORAGE = 'talktopdf_semantic'
const freeStorageKey = () => `talktopdf_free_remaining_${new Date().toISOString().slice(0, 10)}`

// Semantic search downloads a model once; skip it by default on data-saver connections.
const defaultSemantic = () => (navigator.connection?.saveData ? 'off' : 'on')

export default function RAGApp() {
  const [error, setError] = useState(null)
  const [apiKey, setApiKey] = useState(() => readStorage(KEY_STORAGE, ''))
  const [semanticEnabled, setSemanticEnabled] = useState(() => readStorage(SEMANTIC_STORAGE, defaultSemantic()) === 'on')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [isThinking, setIsThinking] = useState(false)
  const [freeRemaining, setFreeRemaining] = useState(() =>
    Number(readStorage(freeStorageKey(), FREE_DAILY_ANSWERS))
  )

  const embedState = useEmbedState()
  const { library, docs, stats, addFiles, removeDoc } = useLibrary({ semanticEnabled, onError: setError })
  const usageLimitReached = !apiKey && freeRemaining <= 0

  useEffect(() => { writeStorage(KEY_STORAGE, apiKey || null) }, [apiKey])
  useEffect(() => { writeStorage(SEMANTIC_STORAGE, semanticEnabled ? 'on' : 'off') }, [semanticEnabled])

  const updateFreeRemaining = useCallback((remaining) => {
    if (remaining === null || Number.isNaN(remaining)) return
    setFreeRemaining(remaining)
    writeStorage(freeStorageKey(), String(remaining))
  }, [])

  const handleFilesAdded = useCallback((files) => {
    setSidebarOpen(false)
    addFiles(files)
  }, [addFiles])

  const handleSendMessage = useCallback(async (question) => {
    if (!question.trim() || isThinking || usageLimitReached || library.size === 0) return

    const history = messages.filter(m => m.content)
    setMessages(prev => [...prev, { role: 'user', content: question }, { role: 'assistant', content: '', sources: [] }])
    setIsThinking(true)

    const setAnswer = (patch) => setMessages(prev => {
      const next = [...prev]
      next[next.length - 1] = { ...next[next.length - 1], ...patch }
      return next
    })

    try {
      const scope = isBroadQuestion(question) ? 'broad' : 'specific'
      const queryVec = semanticEnabled ? await embedQuery(question) : null
      const { sources, lowConfidence } = retrieve(library, { query: question, queryVec, scope })

      const { remaining } = await streamAnswer({
        apiKey,
        question,
        history,
        sources,
        scope,
        onText: text => setAnswer({ content: text })
      })
      setAnswer({ sources, lowConfidence })
      updateFreeRemaining(remaining)
    } catch (err) {
      if (err.limitReached) updateFreeRemaining(0)
      setMessages(prev => prev.slice(0, -1))
      setError(err.message)
    } finally {
      setIsThinking(false)
    }
  }, [apiKey, messages, isThinking, usageLimitReached, library, semanticEnabled, updateFreeRemaining])

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
        apiKey={apiKey}
        hasDocuments={stats.chunks > 0}
        usageLimitReached={usageLimitReached}
        freeRemaining={freeRemaining}
        freeLimit={FREE_DAILY_ANSWERS}
        onToggleSidebar={() => setSidebarOpen(s => !s)}
        onOpenSettings={() => setSettingsOpen(true)}
      />

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
