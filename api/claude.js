import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const MODEL = 'claude-sonnet-4-20250514'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { messages, systemPrompt } = req.body

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: systemPrompt ?? 'Jesteś asystentem edukacyjnym GPW Analyzer. Odpowiadasz po polsku, zwięźle i konkretnie.',
      messages,
    })

    res.json({ content: response.content[0].text })
  } catch (e) {
    console.error('Claude API error:', e)
    res.status(500).json({ error: e.message })
  }
}
