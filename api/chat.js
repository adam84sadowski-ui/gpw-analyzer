import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const MODEL = 'claude-sonnet-4-6'

const SYSTEM = `Jesteś asystentem edukacyjnym GPW Analyzer — aplikacji analizującej Giełdę Papierów Wartościowych w Warszawie.
Odpowiadasz WYŁĄCZNIE po polsku. Jesteś zwięzły, konkretny, pomocny.
NIE dajesz porad inwestycyjnych. Zawsze przypominasz że to analiza edukacyjna.
Możesz objaśniać wskaźniki techniczne (RSI, SMA, wolumen), strategie (scalping, swing, agresywna), i wyniki alertów.
Gdy pytają o aktualne dane (earnings date, wyniki finansowe, komunikaty spółki) — wyszukaj je i podaj konkretne informacje.`

const TOOLS = [{ type: 'web_search_20250305', name: 'web_search' }]

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { messages, system } = req.body
  if (!messages?.length) return res.status(400).json({ error: 'messages required' })

  try {
    const response = await client.messages.create({
      model:      MODEL,
      max_tokens: 2048,
      system:     system ?? SYSTEM,
      tools:      TOOLS,
      messages,
    })

    // Anthropic web_search_20250305 is fully server-side: search + synthesis happen in ONE call.
    // The answer is split across multiple text blocks — concatenate all of them.
    const finalText = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('')

    res.json({ content: finalText || 'Błąd AI — spróbuj ponownie.' })
  } catch (e) {
    console.error('Chat API error:', e)
    res.status(500).json({ error: e.message })
  }
}
