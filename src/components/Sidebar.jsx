import { useCallback, useRef } from 'react'
import DocItem from './DocItem.jsx'

export default function Sidebar({ docs, onFilesAdded, onRemoveDoc, totalDocs, totalChunks, estimatedTokens, sidebarOpen, onCloseSidebar }) {
  const fileInputRef = useRef(null)

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    const files = Array.from(e.dataTransfer.files).filter(f => /\.(pdf|txt|md)$/i.test(f.name))
    if (files.length > 0) onFilesAdded(files)
  }, [onFilesAdded])

  const handleDragOver = useCallback((e) => e.preventDefault(), [])

  const handleFileInput = useCallback((e) => {
    const files = Array.from(e.target.files || [])
    if (files.length > 0) onFilesAdded(files)
    e.target.value = ''
  }, [onFilesAdded])

  return (
    <div
      className={`flex flex-col h-full fixed inset-y-0 left-0 z-40 md:relative md:z-auto transition-transform duration-300 ease-in-out ${
        sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
      }`}
      style={{ width: '270px', minWidth: '270px', backgroundColor: '#16181c', borderRight: '1px solid #1e2028' }}
    >
      <div className="flex items-start justify-between p-4" style={{ borderBottom: '1px solid #1e2028' }}>
        <div>
          <h1 className="text-lg font-semibold" style={{ fontFamily: 'Lora, serif', color: '#c8a96e' }}>
            TalkToPDF
          </h1>
          <p className="text-xs mt-1" style={{ color: '#6b7280' }}>Chat with your documents</p>
        </div>
        <button
          className="md:hidden flex items-center justify-center w-8 h-8 rounded-lg mt-0.5 transition-colors"
          style={{ color: '#6b7280' }}
          onClick={onCloseSidebar}
          onMouseEnter={e => e.currentTarget.style.color = '#e2e8f0'}
          onMouseLeave={e => e.currentTarget.style.color = '#6b7280'}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div
        className="mx-3 mt-3 rounded-lg cursor-pointer transition-colors duration-200"
        style={{ border: '2px dashed #c8a96e33', padding: '20px 16px' }}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onClick={() => fileInputRef.current?.click()}
        onMouseEnter={e => e.currentTarget.style.borderColor = '#c8a96e88'}
        onMouseLeave={e => e.currentTarget.style.borderColor = '#c8a96e33'}
      >
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#c8a96e22' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#c8a96e" strokeWidth="2">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66L9.41 17.41a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium" style={{ color: '#c8a96e' }}>Drop files here</p>
            <p className="text-xs mt-1" style={{ color: '#6b7280' }}>PDF, TXT, MD</p>
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.txt,.md"
          className="hidden"
          onChange={handleFileInput}
        />
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar px-3 py-2 mt-1">
        {docs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2" style={{ color: '#4b5563' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="opacity-40">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            <p className="text-xs">No files yet</p>
          </div>
        ) : (
          <div className="space-y-1">
            {docs.map(doc => (
              <DocItem key={doc.id} doc={doc} onRemove={() => onRemoveDoc(doc.id)} />
            ))}
          </div>
        )}
      </div>

      <div className="p-3" style={{ borderTop: '1px solid #1e2028', backgroundColor: '#111317' }}>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-sm font-semibold" style={{ color: '#c8a96e' }}>{totalDocs}</div>
            <div className="text-xs" style={{ color: '#6b7280' }}>docs</div>
          </div>
          <div>
            <div className="text-sm font-semibold" style={{ color: '#c8a96e' }}>{totalChunks}</div>
            <div className="text-xs" style={{ color: '#6b7280' }}>chunks</div>
          </div>
          <div>
            <div className="text-sm font-semibold" style={{ color: '#c8a96e' }}>
              {estimatedTokens > 1000 ? `${(estimatedTokens / 1000).toFixed(1)}k` : estimatedTokens}
            </div>
            <div className="text-xs" style={{ color: '#6b7280' }}>~tokens</div>
          </div>
        </div>
      </div>
    </div>
  )
}
