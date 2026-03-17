export async function askLLM(apiKey, selectedModel, messages, systemPrompt) {
  if (apiKey) {
    // user's own key — call Groq directly
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: selectedModel,
        max_tokens: 1000,
        messages: [
          { role: 'system', content: systemPrompt },
          ...messages.slice(-8).map(m => ({ role: m.role, content: m.content }))
        ]
      })
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error?.message || 'API error')
    return data.choices[0].message.content
  } else {
    // no key — use our proxy
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: selectedModel, messages: messages.slice(-8), systemPrompt })
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error?.message || 'API error')
    return data.answer
  }
}

export function buildSystemPrompt(chunks) {
  const context = chunks.map((chunk, i) =>
    `[Source ${i + 1}: "${chunk.doc}", chunk ${chunk.chunk}]\n${chunk.text}`
  ).join('\n---\n')

  return `You are a document Q&A assistant. Answer based only on the provided context. Cite sources inline as [Source N]. If the answer isn't in the context, say so.

${context}`
}
