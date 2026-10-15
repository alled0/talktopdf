import { useCallback, useRef } from 'react'
import DocItem from './DocItem.jsx'
import SemanticStatus from './SemanticStatus.jsx'
import { CloseIcon, FolderIcon, PaperclipIcon, SettingsIcon } from './Icons.jsx'
import { ACCEPT_ATTRIBUTE, filterSupported } from '../lib/files.js'
import { formatCount } from '../lib/format.js'

export default function Sidebar({
  docs, stats, onFilesAdded, onRemoveDoc, sidebarOpen, onCloseSidebar,
  semanticEnabled, embedState, onOpenSettings
}) {
  const fileInputRef = useRef(null)

  const handleFileInput = useCallback((e) => {
    const files = filterSupported(e.target.files)
    if (files.length > 0) onFilesAdded(files)
    e.target.value = ''
  }, [onFilesAdded])

  return (
    <aside
      className={`flex flex-col h-full w-[280px] min-w-[280px] fixed inset-y-0 left-0 z-40 md:relative md:z-auto bg-surface border-r border-line transition-transform duration-300 ease-in-out ${
        sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
      }`}
      aria-label="Documents"
    >
      <div className="flex items-start justify-between p-4 border-b border-line">
        <div>
          <h1 className="font-serif text-lg font-semibold text-accent">TalkToPDF</h1>
          <p className="text-xs mt-1 text-subtle">Private, cited answers from your files</p>
        </div>
        <button
          className="md:hidden flex items-center justify-center w-8 h-8 rounded-lg mt-0.5 text-subtle hover:text-ink transition-colors"
          onClick={onCloseSidebar}
          aria-label="Close documents panel"
        >
          <CloseIcon />
        </button>
      </div>

      <button
        type="button"
        className="mx-3 mt-3 rounded-lg border-2 border-dashed px-4 py-5 transition-colors duration-200 border-accent/20 hover:border-accent/50"
        onClick={() => fileInputRef.current?.click()}
      >
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-accent/15 text-accent">
            <PaperclipIcon size={20} />
          </div>
          <div>
            <p className="text-sm font-medium text-accent">Drop files or click</p>
            <p className="text-xs mt-1 text-subtle">PDF, TXT, MD · stays on your device</p>
          </div>
        </div>
      </button>
      <input ref={fileInputRef} type="file" multiple accept={ACCEPT_ATTRIBUTE} className="hidden" onChange={handleFileInput} />

      <div className="flex-1 overflow-y-auto custom-scrollbar px-3 py-2 mt-1">
        {docs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-faint">
            <FolderIcon size={28} strokeWidth={1.5} className="opacity-40" />
            <p className="text-xs">No files yet</p>
          </div>
        ) : (
          <div className="space-y-1">
            {docs.map(doc => (
              <DocItem key={doc.id} doc={doc} semanticEnabled={semanticEnabled} onRemove={() => onRemoveDoc(doc.id)} />
            ))}
          </div>
        )}
      </div>

      <div className="p-3 border-t border-line bg-bg/40 space-y-3">
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            [docs.length, 'docs'],
            [stats.chunks, 'chunks'],
            [formatCount(stats.tokens), '~tokens']
          ].map(([value, label]) => (
            <div key={label}>
              <div className="text-sm font-semibold text-accent">{value}</div>
              <div className="text-xs text-subtle">{label}</div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <SemanticStatus enabled={semanticEnabled} state={embedState} className="flex-1 min-w-0" />
          <button onClick={onOpenSettings} aria-label="Settings"
            className="flex-shrink-0 w-7 h-7 rounded-md flex items-center justify-center text-subtle hover:text-accent transition-colors">
            <SettingsIcon size={15} />
          </button>
        </div>
      </div>
    </aside>
  )
}
