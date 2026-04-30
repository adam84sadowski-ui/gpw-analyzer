import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const MODEL = 'claude-sonnet-4-20250514'

const SYSTEM = `Jesteś asystentem edukacyjnym GPW Analyzer — aplikacji analizującej Giełdę Papierów Wartościowych w Warszawie.
Odpowiadasz WYŁĄCZNIE po polsku. Jesteś zwięzły, konkretny, pomocny.
NIE dajesz porad inwestycyjnych. Zawsze przypominasz że to analiza edukacyjna.
Możesz objaśniać wskaźniki techniczne (RSI, SMA, wolumen), strategie (scalping, swing, agresywna), i wyniki alertów.`

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { messages } = req.body
  if (!messages?.length) return res.status(400).json({ error: 'messages required' })

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 512,
      system: SYSTEM,
      messages,
    })
    res.json({ content: response.content[0].text })
  } catch (e) {
    console.error('Chat API error:', e)
    res.status(500).json({ error: e.message })
  }
}
