import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const MODEL = 'claude-sonnet-4-20250514'

const SYSTEM = `Jesteś asystentem edukacyjnym GPW Analyzer — aplikacji analizującej Giełdę Papierów Wartościowych w Warszawie.
Odpowiadasz WYŁĄCZNIE po polsku. Jesteś zwięzły, konkretny, pomocny.
NIE dajesz porad inwestycyjnych. Zawsze przypominasz że to analiza edukacyjna.
Możesz objaśniać wskaźniki techniczne (RSI, SMA, wolumen), strategie (scalping, swing, agresywna), i wyniki alertów.
Gdy pytają o aktualne dane (earnings date, wyniki finansowe, komunikaty spółki) — wyszukaj je w internecie.`

const TOOLS = [{ type: 'web_search_20250305', name: 'web_search' }]

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { messages, system } = req.body
  if (!messages?.length) return res.status(400).json({ error: 'messages required' })

  try {
    let msgs = [...messages]
    let finalText = null
    const deadline = Date.now() + 18000

    for (let i = 0; i < 5; i++) {
      if (Date.now() > deadline) break

      const response = await client.messages.create({
        model:      MODEL,
        max_tokens: 1024,
        system:     system ?? SYSTEM,
        tools:      TOOLS,
        messages:   msgs,
      })

      if (response.stop_reason !== 'tool_use') {
        finalText = response.content.find(b => b.type === 'text')?.text ?? ''
        break
      }

      // Append assistant turn (includes tool_use blocks + any inline tool_result from Anthropic)
      msgs = [...msgs, { role: 'assistant', content: response.content }]

      // For any tool_use blocks not already satisfied inline, send back tool_result
      const toolUseIds = new Set(response.content.filter(b => b.type === 'tool_use').map(b => b.id))
      const satisfiedIds = new Set(response.content.filter(b => b.type === 'tool_result').map(b => b.tool_use_id))
      const unsatisfied = [...toolUseIds].filter(id => !satisfiedIds.has(id))

      if (unsatisfied.length > 0) {
        msgs = [...msgs, {
          role: 'user',
          content: unsatisfied.map(id => ({
            type:        'tool_result',
            tool_use_id: id,
            content:     'Search results not available.',
          })),
        }]
      }
    }

    res.json({ content: finalText ?? 'Błąd AI — spróbuj ponownie.' })
  } catch (e) {
    console.error('Chat API error:', e)
    res.status(500).json({ error: e.message })
  }
}
