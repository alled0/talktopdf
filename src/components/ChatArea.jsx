import { useState, useRef, useEffect, useCallback } from 'react'
import Message from './Message.jsx'

const suggestions = [
  'Give me a summary',
  "What's the main argument?",
  'Pull out any key dates or names',
  'What does it conclude?'
]

export default function ChatArea({
  messages,
  isThinking,
  onSendMessage,
  apiKey,
  onApiKeyChange,
  hasDocuments,
  usageLimitReached,
  proxyUsage,
  freeLimit
}) {
  const [input, setInput] = useState('')
  const messagesEndRef = useRef(null)
  const textareaRef = useRef(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isThinking])

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'
  }, [input])

  const canSend = hasDocuments && !isThinking && input.trim() && !usageLimitReached

  const handleSend = useCallback(() => {
    if (!canSend) return
    onSendMessage(input.trim())
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }, [canSend, input, onSendMessage])

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  const handleChip = useCallback((chip) => {
    setInput(chip)
    textareaRef.current?.focus()
  }, [])

  return (
    <div className="flex flex-col flex-1 h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-4 space-y-6">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-6">
            <div className="text-center">
              <h2 className="text-2xl font-semibold mb-2" style={{ fontFamily: 'Lora, serif', color: '#c8a96e' }}>
                Ask your documents anything
              </h2>
              <p className="text-sm" style={{ color: '#6b7280' }}>
                Upload a PDF, TXT, or MD file and start asking questions
              </p>
            </div>
            <div className="flex flex-wrap gap-2 justify-center max-w-lg">
              {suggestions.map(s => (
                <button
                  key={s}
                  onClick={() => handleChip(s)}
                  className="px-4 py-2 rounded-full text-sm transition-colors duration-150"
                  style={{
                    backgroundColor: '#1e2028',
                    border: '1px solid #2d3040',
                    color: '#9ca3af',
                    fontFamily: 'DM Mono, monospace'
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = '#c8a96e44'
                    e.currentTarget.style.color = '#c8a96e'
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = '#2d3040'
                    e.currentTarget.style.color = '#9ca3af'
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg, i) => (
              <Message key={i} message={msg} />
            ))}

            {isThinking && (
              <div className="flex gap-3 fade-in">
                <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: '#5dbaa022', color: '#5dbaa0', border: '1px solid #5dbaa044' }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z" />
                  </svg>
                </div>
                <div className="px-4 py-3 rounded-xl" style={{ backgroundColor: '#16181c', border: '1px solid #1e2028' }}>
                  <div className="flex gap-1.5 items-center h-5">
                    <div className="w-2 h-2 rounded-full thinking-dot" style={{ backgroundColor: '#5dbaa0' }} />
                    <div className="w-2 h-2 rounded-full thinking-dot" style={{ backgroundColor: '#5dbaa0' }} />
                    <div className="w-2 h-2 rounded-full thinking-dot" style={{ backgroundColor: '#5dbaa0' }} />
                  </div>
                </div>
              </div>
            )}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="flex-shrink-0 px-4 pb-4 pt-2" style={{ borderTop: '1px solid #1e2028' }}>
        {usageLimitReached ? (
          <p className="text-xs mb-2 text-center" style={{ color: '#fca5a5' }}>
            You've used your {freeLimit} free questions for today. Add your Groq API key above for unlimited access.
          </p>
        ) : !apiKey ? (
          <p className="text-xs mb-2 text-center" style={{ color: '#6b7280' }}>
            {freeLimit - proxyUsage} free question{freeLimit - proxyUsage !== 1 ? 's' : ''} remaining today · Add API key for unlimited
          </p>
        ) : null}
        {!hasDocuments && (
          <p className="text-xs mb-2 text-center" style={{ color: '#6b7280' }}>
            Upload a document first
          </p>
        )}
        <div className="flex gap-2 items-end p-2 rounded-xl" style={{ backgroundColor: '#16181c', border: '1px solid #2d3040' }}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={hasDocuments ? 'Ask something...' : 'Upload a document to begin...'}
            rows={1}
            className="flex-1 resize-none bg-transparent outline-none text-sm leading-relaxed"
            style={{
              color: '#e2e8f0',
              fontFamily: 'DM Mono, monospace',
              minHeight: '24px',
              maxHeight: '160px',
              caretColor: '#c8a96e'
            }}
          />
          <button
            onClick={handleSend}
            disabled={!canSend}
            className="flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center transition-all duration-150"
            style={{
              backgroundColor: canSend ? '#c8a96e' : '#1e2028',
              cursor: canSend ? 'pointer' : 'not-allowed',
              opacity: canSend ? 1 : 0.5
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke={canSend ? '#0e0f11' : '#6b7280'} strokeWidth="2.5">
              <line x1="12" y1="19" x2="12" y2="5" />
              <polyline points="5 12 12 5 19 12" />
            </svg>
          </button>
        </div>
        <p className="text-xs mt-1.5 text-center" style={{ color: '#4b5563' }}>
          Enter to send · Shift+Enter for newline
        </p>
      </div>
    </div>
  )
}
