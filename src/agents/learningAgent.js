import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const MODEL = 'claude-sonnet-4-6'

export async function runLearningAgent(alertHistory) {
  if (!alertHistory || alertHistory.length === 0) return null

  const prompt = `Przeanalizuj wyniki poniższych rekomendacji GPW.
Wykryj wzorce skutecznych i nieskutecznych sygnałów.
Porównaj progi które dawały trafne vs fałszywe sygnały.
Zaproponuj korektę progów wskaźników.
Odpowiedz TYLKO w JSON bez żadnego tekstu przed ani po JSON:
{
  "rsi_threshold": number,
  "volume_multiplier": number,
  "sma_buffer_percent": number,
  "insights": "string po polsku, max 3 zdania",
  "best_stocks": ["ticker1", "ticker2"],
  "worst_stocks": ["ticker1", "ticker2"]
}

DANE:
${JSON.stringify(alertHistory, null, 2)}`

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: 'Jesteś Learning Agentem GPW Analyzer. Analizujesz wyniki rekomendacji i zwracasz JSON z korektami progów.',
    messages: [{ role: 'user', content: prompt }],
  })

  return JSON.parse(response.content[0].text)
}

export function formatWeeklyReport({ scalping, swing, aggressive, bestStock, worstStock, newThresholds, insights, focusTickers, aiHit = 0, aiTotal = 0 }) {
  const pct    = (a, b) => b > 0 ? Math.round((a / b) * 100) : 0
  const aiLine = aiTotal > 0
    ? `\n🤖 <b>TRAFNOŚĆ AI (rekomendacje wejść):</b> ${aiHit}/${aiTotal} (${pct(aiHit, aiTotal)}%)`
    : ''

  return `🧠 <b>RAPORT TYGODNIOWY — Learning Agent</b>

📊 <b>SKUTECZNOŚĆ (ostatnie 30 dni):</b>
⚡ Scalping:   ${scalping.hit}/${scalping.total} trafnych (${pct(scalping.hit, scalping.total)}%)
📈 Swing:      ${swing.hit}/${swing.total} trafnych (${pct(swing.hit, swing.total)}%)
🚀 Agresywna:  ${aggressive.hit}/${aggressive.total} trafnych (${pct(aggressive.hit, aggressive.total)}%)${aiLine}

🏆 <b>NAJLEPSZA SPÓŁKA:</b> ${bestStock.ticker} (${bestStock.pct}% trafności)
📉 <b>NAJSŁABSZA:</b>       ${worstStock.ticker} (${worstStock.pct}% trafności)

🔧 <b>KOREKTY PROGÓW (od jutra):</b>
- RSI próg: ${newThresholds.rsiOld} → ${newThresholds.rsiNew}
- Wolumen mnożnik: ${newThresholds.volOld}x → ${newThresholds.volNew}x
- SMA50 bufor: ${newThresholds.smaBuffer}%

💡 <b>WNIOSEK TYGODNIA:</b>
${insights}

📈 Fokus na przyszły tydzień: ${focusTickers.join(', ')}`
}
