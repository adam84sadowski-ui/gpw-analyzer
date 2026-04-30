const MODEL = 'claude-sonnet-4-20250514'

export async function askClaude(messages, systemPrompt) {
  const res = await fetch('/api/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, systemPrompt }),
  })
  if (!res.ok) throw new Error(`Claude API error: ${res.status}`)
  return res.json()
}
