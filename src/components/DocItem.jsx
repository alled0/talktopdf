import { CloseIcon } from './Icons.jsx'
import { formatBytes } from '../lib/format.js'

const EXT_STYLES = {
  PDF: 'bg-accent/15 text-accent',
  TXT: 'bg-mint/15 text-mint',
  MD: 'bg-violet/15 text-violet'
}

function ProgressBar({ value, className = 'bg-accent' }) {
  return (
    <div className="h-1 mt-1.5 rounded-full bg-elevated overflow-hidden"
      role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
      <div className={`h-full rounded-full transition-[width] duration-300 ${className}`} style={{ width: `${Math.max(4, value * 100)}%` }} />
    </div>
  )
}

export default function DocItem({ doc, semanticEnabled, onRemove }) {
  const ext = doc.name.split('.').pop().toUpperCase()
  const reading = doc.status === 'reading'
  const embedding = !reading && semanticEnabled && doc.embedded < doc.chunkCount
  const fullyIndexed = !reading && (!semanticEnabled || doc.embedded >= doc.chunkCount)

  const meta = [
    formatBytes(doc.size),
    doc.pageCount ? `${doc.pageCount} page${doc.pageCount === 1 ? '' : 's'}` : null,
    !reading ? `${doc.chunkCount} chunks` : null
  ].filter(Boolean).join(' · ')

  return (
    <div className="group flex items-start gap-2.5 p-2 rounded-lg bg-raised hover:bg-elevated transition-colors duration-150">
      <div className={`flex-shrink-0 w-9 h-9 rounded-md flex items-center justify-center text-[10px] font-bold ${EXT_STYLES[ext] || EXT_STYLES.PDF}`}>
        {ext}
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-ink truncate" title={doc.name}>{doc.name}</div>
        <div className="text-[11px] text-subtle mt-0.5 truncate">{meta}</div>

        {reading && (
          <>
            <ProgressBar value={doc.progress} />
            <div className="text-[10px] text-subtle mt-1">
              {doc.progress > 0 ? `Reading… ${Math.round(doc.progress * 100)}%` : 'Opening…'}
            </div>
          </>
        )}

        {embedding && (
          <>
            <ProgressBar value={doc.chunkCount ? doc.embedded / doc.chunkCount : 0} className="bg-mint/70" />
            <div className="text-[10px] text-subtle mt-1">
              Semantic index {doc.chunkCount ? Math.round(doc.embedded / doc.chunkCount * 100) : 0}% · keyword search ready
            </div>
          </>
        )}

        {doc.emptyPages > 0 && !reading && (
          <div className="text-[10px] text-accent/80 mt-1">
            {doc.emptyPages} page{doc.emptyPages === 1 ? '' : 's'} had no selectable text (scanned?)
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5 pt-1">
        {fullyIndexed && (
          <span className="w-2 h-2 rounded-full bg-mint" title={semanticEnabled ? 'Keyword + semantic search ready' : 'Keyword search ready'} />
        )}
        {reading && <span className="w-2 h-2 rounded-full bg-accent pulse-amber" title="Processing" />}
        <button
          onClick={e => { e.stopPropagation(); onRemove() }}
          className="md:opacity-0 md:group-hover:opacity-100 focus:opacity-100 transition-opacity duration-150 rounded p-1 text-subtle hover:text-danger hover:bg-danger/10"
          title="Remove"
          aria-label={`Remove ${doc.name}`}
        >
          <CloseIcon size={12} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  )
}
