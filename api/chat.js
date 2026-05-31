import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const MODEL = 'claude-sonnet-4-20250514'

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

      // Anthropic's web_search provides results as part of response.content
      // Pass full assistant content back so Claude sees its own search results
      msgs = [...msgs, { role: 'assistant', content: response.content }]

      // Build tool_result for every open tool_use — Anthropic fills content server-side
      // If inline results already present (any block with tool_use_id), use them
      // Otherwise send an empty acknowledgment to keep the conversation going
      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use')
      const toolResults = toolUseBlocks.map(tb => {
        const inlineResult = response.content.find(
          b => b.tool_use_id === tb.id && b.type !== 'tool_use'
        )
        return {
          type:        'tool_result',
          tool_use_id: tb.id,
          content:     inlineResult?.content ?? inlineResult?.text ?? 'Kontynuuj analizę.',
        }
      })

      if (toolResults.length > 0) {
        msgs = [...msgs, { role: 'user', content: toolResults }]
      }
    }

    res.json({ content: finalText ?? 'Błąd AI — spróbuj ponownie.' })
  } catch (e) {
    console.error('Chat API error:', e)
    res.status(500).json({ error: e.message })
  }
}
