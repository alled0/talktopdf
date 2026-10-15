import { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react'
import Message from './Message.jsx'
import { ArrowUpIcon, MenuIcon, PaperclipIcon, PlusIcon, SettingsIcon, StopIcon } from './Icons.jsx'

const DEFAULT_SUGGESTIONS = [
  'Give me a summary',
  "What's the main argument?",
  'Pull out any key dates or names',
  'What does it conclude?'
]

const LINKS = [
  ['@alled0', 'https://github.com/alled0'],
  ['LinkedIn', 'https://www.linkedin.com/in/alwaleed-meshal-almutairi-8a48ab263/'],
  ['GitHub', 'https://github.com/alled0/talktopdf']
]

export default function ChatArea({
  messages,
  isThinking,
  onSendMessage,
  onStop,
  onRetry,
  onOpenSource,
  onNewChat,
  apiKey,
  hasDocuments,
  docCount,
  usageLimitReached,
  freeRemaining,
  freeLimit,
  suggestions,
  onToggleSidebar,
  onOpenSettings
}) {
  const [input, setInput] = useState('')
  const scrollRef = useRef(null)
  const textareaRef = useRef(null)
  const stickToBottom = useRef(true)

  // Follow new content only while the reader is already at the bottom.
  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
  }, [])

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [messages])

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'
  }, [input])

  const canSend = hasDocuments && !isThinking && input.trim() && !usageLimitReached

  const send = useCallback((text) => {
    stickToBottom.current = true
    onSendMessage(text)
  }, [onSendMessage])

  const handleSend = useCallback(() => {
    if (!canSend) return
    send(input.trim())
    setInput('')
  }, [canSend, input, send])

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  const handleChip = useCallback((chip) => {
    if (hasDocuments && !isThinking && !usageLimitReached) {
      send(chip)
    } else {
      setInput(chip)
      textareaRef.current?.focus()
    }
  }, [hasDocuments, isThinking, usageLimitReached, send])

  const chips = suggestions?.length ? suggestions : DEFAULT_SUGGESTIONS

  return (
    <main className="flex flex-col flex-1 h-full overflow-hidden min-w-0">
      <header className="flex items-center gap-2 px-3 md:px-5 py-2.5 flex-shrink-0 bg-surface md:bg-transparent border-b border-line">
        <button onClick={onToggleSidebar} aria-label="Open documents"
          className="md:hidden flex items-center justify-center w-8 h-8 rounded-lg text-muted hover:text-ink transition-colors">
          <MenuIcon size={20} />
        </button>
        <h1 className="md:hidden font-serif text-base font-semibold text-accent">TalkToPDF</h1>
        <span className="hidden md:inline text-xs text-subtle">
          {hasDocuments ? `${docCount} document${docCount === 1 ? '' : 's'} ready` : 'No documents yet'}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {messages.length > 0 && (
            <button onClick={onNewChat} disabled={isThinking}
              className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs text-muted hover:text-ink hover:bg-elevated disabled:opacity-40 transition-colors">
              <PlusIcon size={14} /> <span>New chat</span>
            </button>
          )}
          <button onClick={onOpenSettings} aria-label="Settings"
            className="md:hidden w-8 h-8 rounded-lg flex items-center justify-center text-muted hover:text-ink transition-colors">
            <SettingsIcon />
          </button>
        </div>
      </header>

      <div ref={scrollRef} onScroll={handleScroll}
        className="flex-1 overflow-y-auto custom-scrollbar px-3 md:px-6 py-5"
        aria-live="polite">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center min-h-full gap-6 py-6">
            <div className="text-center px-4 max-w-md">
              <h2 className="font-serif text-xl md:text-2xl font-semibold mb-2 text-accent">
                Ask your documents anything
              </h2>
              <p className="text-sm text-subtle leading-relaxed">
                {hasDocuments
                  ? 'Answers cite the exact pages they come from. Click a citation to read the passage.'
                  : 'Add a PDF, TXT or Markdown file. It is read and indexed privately in your browser.'}
              </p>
              {!hasDocuments && (
                <button onClick={onToggleSidebar}
                  className="md:hidden mt-4 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium bg-accent text-bg">
                  <PaperclipIcon size={16} strokeWidth={2.5} />
                  Upload a document
                </button>
              )}
            </div>
            <div className="flex flex-col items-center gap-2 px-4 max-w-xl w-full">
              {suggestions?.length > 0 && (
                <p className="text-[11px] uppercase tracking-wider text-faint">Suggested from your documents</p>
              )}
              <div className="flex flex-wrap gap-2 justify-center">
                {chips.map(s => (
                  <button key={s} onClick={() => handleChip(s)} dir="auto"
                    className="px-3 md:px-4 py-2 rounded-full text-xs md:text-sm bg-elevated border border-line-strong text-muted hover:border-accent/40 hover:text-accent transition-colors duration-150">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-6 max-w-3xl mx-auto">
            {messages.map(msg => (
              <Message key={msg.id} message={msg} onOpenSource={onOpenSource} onRetry={onRetry} />
            ))}
          </div>
        )}
      </div>

      <div className="flex-shrink-0 px-3 md:px-4 pb-4 pt-2 border-t border-line">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-center gap-2 mb-2 text-xs">
            {usageLimitReached ? (
              <p className="text-danger text-center">
                You've used today's {freeLimit} free questions.{' '}
                <button onClick={onOpenSettings} className="underline hover:text-ink">Add your free Groq key</button>
                {' '}to keep going.
              </p>
            ) : apiKey ? (
              <p className="text-subtle">Using your Groq key · unlimited</p>
            ) : (
              <p className="text-subtle">
                {freeRemaining} free question{freeRemaining !== 1 ? 's' : ''} left today
              </p>
            )}
          </div>

          <div className="flex gap-2 items-end p-2 rounded-xl bg-surface border border-line-strong focus-within:border-accent/40 transition-colors">
            <button onClick={onToggleSidebar} aria-label="Add documents"
              className="md:hidden flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-subtle hover:text-accent transition-colors">
              <PaperclipIcon />
            </button>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={hasDocuments ? 'Ask something…' : 'Upload a document to begin…'}
              aria-label="Your question"
              dir="auto"
              rows={1}
              className="flex-1 resize-none bg-transparent outline-none text-sm leading-relaxed text-ink placeholder:text-faint caret-accent min-h-[24px] max-h-[160px] py-1.5"
            />
            {isThinking ? (
              <button onClick={onStop} aria-label="Stop generating"
                className="flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center bg-elevated text-ink hover:bg-line-strong transition-colors">
                <StopIcon size={14} />
              </button>
            ) : (
              <button onClick={handleSend} disabled={!canSend} aria-label="Send"
                className="flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center transition-all duration-150 bg-accent text-bg disabled:bg-elevated disabled:text-subtle disabled:opacity-50 disabled:cursor-not-allowed">
                <ArrowUpIcon size={16} strokeWidth={2.5} />
              </button>
            )}
          </div>

          <p className="hidden md:block text-xs mt-1.5 text-center text-faint">
            Enter to send · Shift+Enter for a new line
          </p>
          <p className="text-xs mt-2 text-center text-dim">
            Built by{' '}
            {LINKS.map(([label, href], i) => (
              <span key={label}>
                {i > 0 && ' · '}
                <a href={href} target="_blank" rel="noopener noreferrer" className="text-faint hover:text-accent transition-colors">{label}</a>
              </span>
            ))}
          </p>
        </div>
      </div>
    </main>
  )
}
