import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const MODEL = 'claude-sonnet-4-6'

export async function runLearningAgent(alertHistory, closedPositions = []) {
  if ((!alertHistory || alertHistory.length === 0) && closedPositions.length === 0) return null

  const positionSummary = closedPositions.map(p => {
    const pnlPct = p.exitPrice && p.entryPrice
      ? Math.round((p.exitPrice - p.entryPrice) / p.entryPrice * 10000) / 100
      : null
    const hitTarget = pnlPct != null && p.target  && pnlPct >= p.target
    const hitStop   = pnlPct != null && p.stopLoss && pnlPct <= -p.stopLoss
    return {
      ticker:    p.ticker,
      exchange:  p.exchange ?? 'GPW',
      strategy:  p.strategy,
      signal:    p.signal,
      pnlPct,
      hitTarget,
      hitStop,
      timeExit:  !hitTarget && !hitStop,
      entryRsi:  p.entryRsi   ?? null,
      entryVol:  p.entryVolMult ?? null,
      entryScore: p.entryScore ?? null,
      daysHeld:  p.exitDate && p.entryDate
        ? Math.round((new Date(p.exitDate) - new Date(p.entryDate)) / 86400000)
        : null,
    }
  })

  const losers  = positionSummary.filter(p => p.pnlPct != null && p.pnlPct < 0)
  const winners = positionSummary.filter(p => p.pnlPct != null && p.pnlPct > 0)
  const avgLoss = losers.length
    ? Math.round(losers.reduce((s, p) => s + p.pnlPct, 0) / losers.length * 10) / 10
    : null
  const avgWin  = winners.length
    ? Math.round(winners.reduce((s, p) => s + p.pnlPct, 0) / winners.length * 10) / 10
    : null

  const prompt = `Jesteś Learning Agentem GPW Analyzer. Analizujesz realne wyniki inwestycyjne.

ZAMKNIĘTE POZYCJE (${closedPositions.length} łącznie, ${winners.length} zysk, ${losers.length} strata):
Średni zysk: ${avgWin ?? 'brak'}% | Średnia strata: ${avgLoss ?? 'brak'}%
${JSON.stringify(positionSummary, null, 2)}

HISTORIA ALERTÓW (${alertHistory.length} sygnałów):
${JSON.stringify(alertHistory.slice(0, 20).map(a => ({
  ticker: a.ticker, exchange: a.exchange ?? 'GPW', strategy: a.strategy,
  signal: a.signal, score: a.score, rsi: a.rsi, indexTrend: a.indexTrend,
  timestamp: a.timestamp,
})), null, 2)}

Zadanie:
1. Zidentyfikuj które warunki wejścia (RSI, wolumen, score) korelują ze stratami
2. Zaproponuj ODDZIELNE korekty progów dla GPW i NYSE
3. Jeśli widzisz wzorzec strat (np. "zbyt wysokie RSI przy wejściu" lub "za niski score") — napisz wprost
4. Oceń czy obecne progi są za luźne czy za restrykcyjne

Odpowiedz TYLKO w JSON bez żadnego tekstu:
{
  "GPW": {
    "rsi_threshold": number,
    "volume_multiplier": number,
    "sma_buffer_percent": number
  },
  "NYSE": {
    "rsi_threshold": number,
    "volume_multiplier": number,
    "sma_buffer_percent": number
  },
  "insights": "string po polsku, max 4 zdania — konkretne wnioski z danych o stratach",
  "loss_pattern": "string — główna przyczyna strat lub null",
  "best_stocks": ["ticker1", "ticker2"],
  "worst_stocks": ["ticker1", "ticker2"],
  "confidence": number (0-100)
}`

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: 'Jesteś Learning Agentem GPW Analyzer. Analizujesz realne P&L pozycji i zwracasz JSON z korektami progów.',
    messages: [{ role: 'user', content: prompt }],
  })

  const text  = response.content[0].text
  const match = text?.match(/\{[\s\S]*\}/)
  if (!match) throw new Error(`Invalid JSON from Learning Agent: ${text?.slice(0, 50)}`)
  return JSON.parse(match[0])
}

export function formatWeeklyReport({ scalping, swing, aggressive, bestStock, worstStock, newThresholds, insights, lossPattern, focusTickers, aiHit = 0, aiTotal = 0, positionStats }) {
  const pct    = (a, b) => b > 0 ? Math.round((a / b) * 100) : 0
  const aiLine = aiTotal > 0
    ? `\n🤖 <b>TRAFNOŚĆ AI:</b> ${aiHit}/${aiTotal} (${pct(aiHit, aiTotal)}%)`
    : ''
  const posLine = positionStats
    ? `\n💰 <b>POZYCJE:</b> ${positionStats.winners}W / ${positionStats.losers}L | śr. zysk ${positionStats.avgWin ?? '—'}% | śr. strata ${positionStats.avgLoss ?? '—'}%`
    : ''
  const lossLine = lossPattern ? `\n⚠️ <b>WZORZEC STRAT:</b> ${lossPattern}` : ''

  return `🧠 <b>RAPORT TYGODNIOWY — Learning Agent</b>

📊 <b>SKUTECZNOŚĆ (30 dni):</b>
⚡ Scalping:   ${scalping.hit}/${scalping.total} (${pct(scalping.hit, scalping.total)}%)
📈 Swing:      ${swing.hit}/${swing.total} (${pct(swing.hit, swing.total)}%)
🚀 Agresywna:  ${aggressive.hit}/${aggressive.total} (${pct(aggressive.hit, aggressive.total)}%)${posLine}${aiLine}${lossLine}

🏆 <b>NAJLEPSZA:</b> ${bestStock?.ticker ?? 'N/A'} (${bestStock?.pct ?? 0}%)
📉 <b>NAJSŁABSZA:</b> ${worstStock?.ticker ?? 'N/A'} (${worstStock?.pct ?? 0}%)

🔧 <b>KOREKTY PROGÓW:</b>
GPW — RSI: ${newThresholds.gpwRsiOld} → ${newThresholds.gpwRsiNew} | Vol: ${newThresholds.gpwVolNew}x
NYSE — RSI: ${newThresholds.nyseRsiOld} → ${newThresholds.nyseRsiNew} | Vol: ${newThresholds.nyseVolNew}x

💡 <b>WNIOSEK:</b>
${insights}

📈 Fokus: ${focusTickers.join(', ')}`
}
