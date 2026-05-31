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

    // Single API call — Anthropic's web_search_20250305 executes server-side:
    // search + results are returned inline in the same response.
    // If stop_reason is 'tool_use', we do ONE continuation to collect the final answer.
    const response = await client.messages.create({
      model:      MODEL,
      max_tokens: 2048,
      system:     system ?? SYSTEM,
      tools:      TOOLS,
      messages:   msgs,
    })

    // DEBUG — remove after investigation
    console.log('RESPONSE1 stop_reason:', response.stop_reason)
    console.log('RESPONSE1 content types:', response.content.map(b => ({ type: b.type, tool_use_id: b.tool_use_id, id: b.id, name: b.name })))

    if (response.stop_reason !== 'tool_use') {
      finalText = response.content.find(b => b.type === 'text')?.text ?? ''
    } else {
      // Claude searched — pass full content back and get the written answer
      msgs = [...msgs, { role: 'assistant', content: response.content }]

      // For each open tool_use, use Anthropic's inline result if available,
      // otherwise acknowledge with a minimal placeholder
      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use')
      const toolResults = toolUseBlocks.map(tb => {
        // Anthropic may provide results as any block with matching tool_use_id
        const inline = response.content.find(b => b.tool_use_id === tb.id)
        return {
          type:        'tool_result',
          tool_use_id: tb.id,
          content:     inline ? JSON.stringify(inline) : 'Wyniki wyszukiwania dostarczone.',
        }
      })

      msgs = [...msgs, { role: 'user', content: toolResults }]

      // No tools in continuation — forces Claude to answer using search results already in context
      const response2 = await client.messages.create({
        model:      MODEL,
        max_tokens: 2048,
        system:     system ?? SYSTEM,
        messages:   msgs,
      })

      finalText = response2.content.find(b => b.type === 'text')?.text ?? ''
    }

    res.json({ content: finalText ?? 'Błąd AI — spróbuj ponownie.' })
  } catch (e) {
    console.error('Chat API error:', e)
    res.status(500).json({ error: e.message })
  }
}
