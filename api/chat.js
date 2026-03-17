export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { model, messages, systemPrompt } = req.body

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: model || 'llama-3.3-70b-versatile',
      max_tokens: 1000,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.map(m => ({ role: m.role, content: m.content }))
      ]
    })
  })

  const data = await response.json()
  if (!response.ok) return res.status(response.status).json(data)
  res.json({ answer: data.choices[0].message.content })
}
