import { memo, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CheckIcon, CopyIcon, RetryIcon, SparkIcon, UserIcon } from './Icons.jsx'
import { citedNumbers, linkCitations, stripCitations } from '../lib/citations.js'
import { sourceShortLabel } from '../lib/format.js'

const REMARK_PLUGINS = [remarkGfm]
const NO_SOURCES = []

const MODE_LABELS = {
  full: 'Read the whole document',
  coverage: 'Sampled across the document',
  search: 'Searched your documents'
}

function Avatar({ isUser }) {
  return (
    <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center border ${
      isUser ? 'bg-accent/15 text-accent border-accent/30' : 'bg-mint/15 text-mint border-mint/30'
    }`}>
      {isUser ? <UserIcon size={16} /> : <SparkIcon size={15} />}
    </div>
  )
}

function ThinkingDots({ label }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-surface border border-line">
      <div className="flex gap-1.5 items-center h-5" aria-hidden="true">
        <div className="w-2 h-2 rounded-full thinking-dot bg-mint" />
        <div className="w-2 h-2 rounded-full thinking-dot bg-mint" />
        <div className="w-2 h-2 rounded-full thinking-dot bg-mint" />
      </div>
      <span className="text-xs text-subtle">{label}</span>
    </div>
  )
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard unavailable (insecure context); nothing to do
    }
  }
  return (
    <button onClick={copy} aria-label={copied ? 'Copied' : 'Copy answer'}
      className="inline-flex items-center gap-1 text-[11px] text-faint hover:text-ink transition-colors">
      {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />} {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

// "openai/gpt-oss-120b" -> "gpt-oss-120b"
const modelLabel = model => model?.split('/').pop()

function AssistantMessage({ message, onOpenSource, onRetry, onOpenSettings }) {
  const sources = message.sources ?? NO_SOURCES
  const { content, status } = message

  const markdown = useMemo(() => linkCitations(content, sources.length), [content, sources.length])
  const cited = useMemo(() => citedNumbers(content, sources.length), [content, sources.length])
  const components = useMemo(() => ({
    a: ({ href, children }) => {
      if (href?.startsWith('#cite-')) {
        const n = Number(href.slice(6))
        return (
          <button type="button" className="cite-pill" onClick={() => onOpenSource(message.id, n)}
            aria-label={`Source ${n}: ${sourceShortLabel(sources[n - 1])}`} title={sourceShortLabel(sources[n - 1])}>
            {n}
          </button>
        )
      }
      return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
    }
  }), [message.id, sources, onOpenSource])

  if (!content && (status === 'searching' || status === 'streaming')) {
    return <ThinkingDots label={status === 'searching' ? 'Searching your documents…' : 'Writing…'} />
  }

  return (
    <>
      {(content || status !== 'error') && (
        <div className="ai-bubble px-4 py-3 rounded-xl text-sm leading-relaxed bg-surface border border-line text-ink break-words" dir="auto">
          <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={components}>{markdown}</ReactMarkdown>
          {status === 'streaming' && <span className="stream-cursor" aria-hidden="true" />}
          {status === 'stopped' && <p className="text-xs text-subtle italic mt-2">Stopped.</p>}
        </div>
      )}

      {status === 'error' && (
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 rounded-xl text-sm bg-danger/5 border border-danger/30 text-danger" role="alert">
          <span className="flex-1 min-w-0">{message.error}</span>
          {message.needsKey && onOpenSettings && (
            <button onClick={onOpenSettings}
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md bg-accent text-bg hover:opacity-90 transition-opacity">
              Add free key
            </button>
          )}
          {onRetry && (
            <button onClick={() => onRetry(message.id)}
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md border border-danger/40 hover:bg-danger/10 transition-colors">
              <RetryIcon size={12} /> Retry
            </button>
          )}
        </div>
      )}

      {message.lowConfidence && status !== 'error' && (
        <p className="text-[11px] text-accent/80">
          No passage clearly matched this question, so the answer may be incomplete.
        </p>
      )}

      {sources.length > 0 && status !== 'searching' && (
        <div className="flex flex-wrap items-center gap-1.5">
          {cited.map(n => (
            <button key={n} onClick={() => onOpenSource(message.id, n)} title={sources[n - 1].label}
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs bg-mint/10 border border-mint/20 text-mint hover:bg-mint/20 transition-colors">
              <span className="text-mint/60">{n}</span>
              {sourceShortLabel(sources[n - 1])}
            </button>
          ))}
          <button onClick={() => onOpenSource(message.id, cited[0] || 1)}
            className="text-[11px] text-faint hover:text-muted transition-colors px-1">
            {MODE_LABELS[message.mode] || 'Sources'} · {sources.length} excerpt{sources.length === 1 ? '' : 's'}
          </button>
          {message.model && (
            <span className="text-[11px] text-faint" title={`Answered by ${message.model}`}>· {modelLabel(message.model)}</span>
          )}
          {(status === 'done' || status === 'stopped') && content && (
            <span className="ml-1"><CopyButton text={stripCitations(content)} /></span>
          )}
        </div>
      )}
    </>
  )
}

function Message({ message, onOpenSource, onRetry, onOpenSettings }) {
  const isUser = message.role === 'user'

  return (
    <div className={`flex gap-3 fade-in ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <Avatar isUser={isUser} />
      <div className={`flex flex-col gap-2 min-w-0 max-w-[85%] md:max-w-[75%] ${isUser ? 'items-end' : 'items-start'}`}>
        {isUser ? (
          <div className="px-4 py-3 rounded-xl text-sm leading-relaxed bg-accent/10 border border-accent/20 text-ink whitespace-pre-wrap break-words" dir="auto">
            {message.content}
          </div>
        ) : (
          <AssistantMessage message={message} onOpenSource={onOpenSource} onRetry={onRetry} onOpenSettings={onOpenSettings} />
        )}
      </div>
    </div>
  )
}

export default memo(Message)
