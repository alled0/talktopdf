import { useEffect, useMemo, useRef } from 'react'
import { CloseIcon } from './Icons.jsx'
import { citedNumbers } from '../lib/citations.js'
import { formatPages } from '../lib/format.js'
import { tokenize } from '../lib/text.js'

// Highlights words that match the (stemmed, normalized) search terms.
function Highlighted({ text, terms }) {
  const parts = useMemo(() => text.split(/(\s+)/).map((part, i) =>
    terms.size && part.trim() && tokenize(part).some(t => terms.has(t))
      ? <mark key={i}>{part}</mark>
      : part
  ), [text, terms])
  return <>{parts}</>
}

export default function SourcePanel({ message, activeN, onSelect, onClose }) {
  const sources = message.sources
  const source = sources[activeN - 1]
  const closeRef = useRef(null)
  const cited = useMemo(() => new Set(citedNumbers(message.content, sources.length)), [message.content, sources.length])
  const terms = useMemo(() => new Set(tokenize(message.query || '')), [message.query])

  useEffect(() => { closeRef.current?.focus() }, [])

  useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight' && activeN < sources.length) onSelect(activeN + 1)
      else if (e.key === 'ArrowLeft' && activeN > 1) onSelect(activeN - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeN, sources.length, onSelect, onClose])

  if (!source) return null
  const pages = formatPages(source.pageStart, source.pageEnd) || `part ${source.part}`

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50 md:bg-black/30" onClick={onClose} />
      <aside role="dialog" aria-modal="true" aria-labelledby="source-title"
        className="panel-in fixed z-50 inset-x-0 bottom-0 h-[80vh] rounded-t-2xl md:rounded-none md:inset-y-0 md:left-auto md:right-0 md:h-full md:w-[460px] flex flex-col bg-surface border-t md:border-t-0 md:border-l border-line-strong shadow-2xl">

        <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-line">
          <div className="min-w-0">
            <h2 id="source-title" className="font-serif text-lg text-accent">Source {activeN}</h2>
            <p className="text-xs text-muted mt-0.5 truncate" title={source.docName}>
              {source.docName} · {pages}
            </p>
          </div>
          <button ref={closeRef} onClick={onClose} aria-label="Close source"
            className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-subtle hover:text-ink transition-colors">
            <CloseIcon />
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5 px-5 py-3 border-b border-line" role="tablist" aria-label="Sources for this answer">
          {sources.map(s => {
            const active = s.n === activeN
            return (
              <button key={s.n} role="tab" aria-selected={active} onClick={() => onSelect(s.n)}
                title={`${s.label}${cited.has(s.n) ? ' (cited)' : ''}`}
                className={`min-w-[28px] h-7 px-2 rounded-md text-xs transition-colors border ${
                  active
                    ? 'bg-accent text-bg border-accent'
                    : cited.has(s.n)
                      ? 'border-accent/40 text-accent hover:bg-accent/10'
                      : 'border-line-strong text-subtle hover:text-muted'
                }`}>
                {s.n}
              </button>
            )
          })}
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar px-5 py-4">
          <p className="source-text font-serif text-[15px] leading-7 text-ink/90 whitespace-pre-wrap break-words" dir="auto">
            <Highlighted text={source.text} terms={terms} />
          </p>
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-line text-xs">
          <span className="text-faint">
            {cited.has(activeN) ? 'Cited in the answer' : 'Provided as context'} · exact text sent to the AI
          </span>
          <div className="flex gap-1">
            <button onClick={() => onSelect(activeN - 1)} disabled={activeN <= 1} aria-label="Previous source"
              className="px-2.5 py-1 rounded-md border border-line-strong text-muted hover:text-ink disabled:opacity-30 transition-colors">‹</button>
            <button onClick={() => onSelect(activeN + 1)} disabled={activeN >= sources.length} aria-label="Next source"
              className="px-2.5 py-1 rounded-md border border-line-strong text-muted hover:text-ink disabled:opacity-30 transition-colors">›</button>
          </div>
        </div>
      </aside>
    </>
  )
}
