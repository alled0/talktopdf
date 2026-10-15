import { useEffect, useState } from 'react'
import { CloseIcon, ExternalIcon, EyeIcon, EyeOffIcon, KeyIcon } from './Icons.jsx'

// Mounted only while open, so the draft starts from the saved key every time.
export default function SettingsPanel({ onClose, apiKey, onApiKeyChange, freeRemaining, freeLimit, children }) {
  const [draft, setDraft] = useState(apiKey)
  const [reveal, setReveal] = useState(false)

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const trimmed = draft.trim()
  const looksLikeGroqKey = /^gsk_[A-Za-z0-9]{20,}$/.test(trimmed)
  const dirty = trimmed !== apiKey

  const save = e => {
    e.preventDefault()
    onApiKeyChange(trimmed)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center md:justify-end p-3 md:p-6"
      role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      <div className="relative w-full max-w-md rounded-xl border border-line-strong bg-surface shadow-2xl fade-in">
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <h2 id="settings-title" className="font-serif text-lg text-accent">Settings</h2>
          <button onClick={onClose} aria-label="Close settings"
            className="w-8 h-8 rounded-lg flex items-center justify-center text-subtle hover:text-ink transition-colors">
            <CloseIcon />
          </button>
        </div>

        <form onSubmit={save} className="px-5 py-4 space-y-3">
          <div className="flex items-center gap-2 text-sm text-ink">
            <KeyIcon size={16} className="text-accent" />
            Groq API key <span className="text-subtle">(optional)</span>
          </div>
          <p className="text-xs leading-relaxed text-muted">
            {apiKey
              ? 'You are using your own key: unlimited questions, sent straight from your browser to Groq.'
              : `The free tier allows ${freeLimit} questions per day (${freeRemaining} left). Add your own free Groq key for unlimited use.`}
            {' '}The key is stored only in this browser.
          </p>

          <div className="flex items-center gap-2 rounded-lg border border-line-strong bg-bg px-3 focus-within:border-accent/60">
            <input
              type={reveal ? 'text' : 'password'}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              placeholder="gsk_…"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              aria-label="Groq API key"
              className="flex-1 min-w-0 bg-transparent py-2.5 text-sm text-ink outline-none placeholder:text-faint"
            />
            <button type="button" onClick={() => setReveal(r => !r)}
              aria-label={reveal ? 'Hide key' : 'Show key'}
              className="text-subtle hover:text-ink transition-colors">
              {reveal ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
            </button>
          </div>

          {trimmed && !looksLikeGroqKey && (
            <p className="text-xs text-danger">That doesn't look like a Groq key (they start with "gsk_").</p>
          )}

          <div className="flex items-center justify-between gap-3 pt-1">
            <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-mint hover:underline">
              Get a free key <ExternalIcon size={12} />
            </a>
            <div className="flex gap-2">
              {apiKey && (
                <button type="button" onClick={() => { onApiKeyChange(''); onClose() }}
                  className="px-3 py-2 rounded-lg text-xs text-muted border border-line-strong hover:text-danger hover:border-danger/40 transition-colors">
                  Remove key
                </button>
              )}
              <button type="submit" disabled={!dirty}
                className="px-4 py-2 rounded-lg text-xs font-medium bg-accent text-bg disabled:opacity-40 disabled:cursor-not-allowed transition-opacity">
                Save
              </button>
            </div>
          </div>
        </form>

        {children}
      </div>
    </div>
  )
}
