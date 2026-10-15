import { EMBED_MODEL_SIZE_MB } from '../lib/config.js'

export function describeSemantic(enabled, state) {
  if (!enabled) return { tone: 'off', text: 'Keyword search only' }
  switch (state.status) {
    case 'loading':
      return state.progress >= 99.5
        ? { tone: 'busy', text: 'Starting semantic model…' }
        : { tone: 'busy', text: `Loading semantic model… ${Math.round(state.progress)}%` }
    case 'ready':
      return { tone: 'ok', text: 'Semantic + keyword search' }
    case 'error':
      return { tone: 'error', text: 'Semantic model unavailable, using keywords' }
    default:
      return { tone: 'off', text: `Semantic search starts with your first document (~${EMBED_MODEL_SIZE_MB} MB once)` }
  }
}

const DOT = {
  off: 'bg-faint',
  busy: 'bg-accent pulse-amber',
  ok: 'bg-mint',
  error: 'bg-danger'
}

export default function SemanticStatus({ enabled, state, className = '' }) {
  const { tone, text } = describeSemantic(enabled, state)
  return (
    <div className={`flex items-center gap-2 text-[11px] text-subtle ${className}`} aria-live="polite">
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${DOT[tone]}`} />
      <span className="truncate" title={text}>{text}</span>
    </div>
  )
}
