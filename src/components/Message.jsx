import ReactMarkdown from 'react-markdown'

function UserAvatar() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  )
}

function AIAvatar() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z" />
    </svg>
  )
}

export default function Message({ message }) {
  const isUser = message.role === 'user'

  return (
    <div className={`flex gap-3 fade-in ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center"
        style={{
          backgroundColor: isUser ? '#c8a96e22' : '#5dbaa022',
          color: isUser ? '#c8a96e' : '#5dbaa0',
          border: `1px solid ${isUser ? '#c8a96e44' : '#5dbaa044'}`
        }}>
        {isUser ? <UserAvatar /> : <AIAvatar />}
      </div>

      <div className={`flex flex-col gap-2 max-w-[75%] ${isUser ? 'items-end' : 'items-start'}`}>
        <div className={`px-4 py-3 rounded-xl text-sm leading-relaxed${isUser ? '' : ' ai-bubble'}`}
          style={{
            backgroundColor: isUser ? '#c8a96e1a' : '#16181c',
            border: `1px solid ${isUser ? '#c8a96e33' : '#1e2028'}`,
            color: '#e2e8f0',
            whiteSpace: isUser ? 'pre-wrap' : undefined,
            wordBreak: 'break-word'
          }}>
          {isUser ? message.content : <ReactMarkdown>{message.content}</ReactMarkdown>}
        </div>

        {!isUser && message.citations?.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1">
            {message.citations.map((cit, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs"
                style={{ backgroundColor: '#5dbaa015', border: '1px solid #5dbaa033', color: '#5dbaa0' }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#5dbaa0' }} />
                {cit.doc} · {cit.chunk}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
