export default function DocItem({ doc, onRemove }) {
  const ext = doc.name.split('.').pop().toUpperCase()
  const extColors = { PDF: '#c8a96e', TXT: '#5dbaa0', MD: '#8b7cf8' }
  const color = extColors[ext] || '#c8a96e'

  return (
    <div className="flex items-center gap-2 p-2 rounded-lg group transition-colors duration-150"
      style={{ backgroundColor: '#1a1c22' }}
      onMouseEnter={e => e.currentTarget.style.backgroundColor = '#1e2028'}
      onMouseLeave={e => e.currentTarget.style.backgroundColor = '#1a1c22'}>

      <div className="flex-shrink-0 w-9 h-9 rounded-md flex items-center justify-center text-xs font-bold"
        style={{ backgroundColor: `${color}22`, color, fontFamily: 'DM Mono, monospace' }}>
        {ext}
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium truncate" style={{ color: '#e2e8f0' }} title={doc.name}>
          {doc.name}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs" style={{ color: '#6b7280' }}>
            {(doc.size / 1024).toFixed(1)}KB
          </span>
          {doc.status === 'ready' && (
            <span className="text-xs" style={{ color: '#6b7280' }}>· {doc.chunkCount} chunks</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {doc.status === 'processing' && (
          <div className="w-2 h-2 rounded-full pulse-amber" style={{ backgroundColor: '#c8a96e' }} />
        )}
        {doc.status === 'ready' && (
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#5dbaa0' }} />
        )}

        <button
          onClick={(e) => { e.stopPropagation(); onRemove() }}
          className="opacity-0 group-hover:opacity-100 transition-opacity duration-150 rounded p-0.5 hover:bg-red-900/30"
          style={{ color: '#6b7280' }}
          title="Remove"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  )
}
