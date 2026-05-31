import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const MODEL = 'claude-sonnet-4-20250514'

const SYSTEM = `Jesteś asystentem edukacyjnym GPW Analyzer — aplikacji analizującej Giełdę Papierów Wartościowych w Warszawie.
Odpowiadasz WYŁĄCZNIE po polsku. Jesteś zwięzły, konkretny, pomocny.
NIE dajesz porad inwestycyjnych. Zawsze przypominasz że to analiza edukacyjna.
Możesz objaśniać wskaźniki techniczne (RSI, SMA, wolumen), strategie (scalping, swing, agresywna), i wyniki alertów.
Gdy pytają o aktualne dane (earnings date, wyniki finansowe, komunikaty spółki) — wyszukaj je w internecie i podaj konkretne informacje.`

const TOOLS = [{ type: 'web_search_20250305', name: 'web_search' }]

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { messages, system } = req.body
  if (!messages?.length) return res.status(400).json({ error: 'messages required' })

  try {
    let msgs = [...messages]
    let finalText = null
    const deadline = Date.now() + 25000

    for (let i = 0; i < 6; i++) {
      if (Date.now() > deadline) break

      const response = await client.messages.create({
        model:      MODEL,
        max_tokens: 2048,
        system:     system ?? SYSTEM,
        tools:      TOOLS,
        messages:   msgs,
      })

      if (response.stop_reason !== 'tool_use') {
        finalText = response.content.find(b => b.type === 'text')?.text ?? ''
        break
      }

      // Append full assistant content — Anthropic's web_search provides results inline
      // as non-text/non-tool_use blocks (e.g. tool_result or web_search_tool_result)
      msgs = [...msgs, { role: 'assistant', content: response.content }]

      // Only add manual tool_result if Anthropic did NOT provide inline results
      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use')
      const inlineResultIds = new Set(
        response.content
          .filter(b => b.type !== 'text' && b.type !== 'tool_use' && b.tool_use_id)
          .map(b => b.tool_use_id)
      )
      const needsManualResult = toolUseBlocks.filter(tb => !inlineResultIds.has(tb.id))

      if (needsManualResult.length > 0) {
        msgs = [...msgs, {
          role: 'user',
          content: needsManualResult.map(tb => ({
            type:        'tool_result',
            tool_use_id: tb.id,
            content:     'Wyniki wyszukiwania niedostępne — odpowiedz na podstawie wiedzy treningowej.',
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
