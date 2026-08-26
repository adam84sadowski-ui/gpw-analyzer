import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const MODEL  = 'claude-sonnet-4-6'

export async function runLearningAgent(closedPositions = [], openPositions = []) {
  if (closedPositions.length === 0) return null

  // ── Build closed position details for Claude ──────────────────────────────
  const details = closedPositions.map(p => {
    const ep  = p.avgEntryPrice ?? p.entryPrice
    const pnl = p.pnlPct != null ? p.pnlPct
      : (p.exitPrice && ep ? Math.round((p.exitPrice - ep) / ep * 10000) / 100 : null)
    return {
      ticker:     p.ticker,
      exchange:   p.exchange ?? 'GPW',
      strategy:   p.strategy,
      signal:     p.signal,
      pnl:        pnl,
      hitTarget:  pnl != null && p.target   != null && pnl >=  p.target,
      hitStop:    pnl != null && p.stopLoss != null && pnl <= -p.stopLoss,
      daysHeld:   p.exitDate && p.entryDate
        ? Math.round((new Date(p.exitDate) - new Date(p.entryDate)) / 86400000) : null,
      entryRsi:   p.entryRsi   ?? null,
      entryVol:   p.entryVolMult ?? null,
      entryScore: p.entryScore ?? null,
      target:     p.target    ?? null,
      stopLoss:   p.stopLoss  ?? null,
    }
  })

  // ── Per-strategy summary for prompt ──────────────────────────────────────
  const byStrategy = {}
  for (const d of details) {
    const s = d.strategy ?? 'unknown'
    if (!byStrategy[s]) byStrategy[s] = { wins: [], losses: [] }
    if (d.pnl == null) continue
    if (d.pnl >= 0) byStrategy[s].wins.push(d)
    else             byStrategy[s].losses.push(d)
  }

  const stratSummary = Object.entries(byStrategy).map(([s, data]) => {
    const wins   = data.wins, losses = data.losses
    const avgWin  = wins.length   ? (wins.reduce((a, p) => a + p.pnl, 0)   / wins.length).toFixed(1)   : 'N/A'
    const avgLoss = losses.length ? (losses.reduce((a, p) => a + p.pnl, 0) / losses.length).toFixed(1) : 'N/A'
    const lossRsis = losses.map(p => p.entryRsi).filter(Boolean)
    const winRsis  = wins.map(p => p.entryRsi).filter(Boolean)
    return `${s}: ${wins.length}W/${losses.length}L | śr. zysk ${avgWin}% | śr. strata ${avgLoss}%`
      + (winRsis.length  ? ` | RSI przy zyskach: ${winRsis.join(', ')}`   : '')
      + (lossRsis.length ? ` | RSI przy stratach: ${lossRsis.join(', ')}` : '')
  }).join('\n')

  // ── Open positions context ─────────────────────────────────────────────────
  const now = Date.now()
  const HORIZON = { scalping: 5, swing: 40, aggressive: 30 }
  const openCtx = openPositions.map(p => {
    const daysHeld = p.entryDate ? Math.round((now - new Date(p.entryDate)) / 86400000) : null
    return `${p.ticker} (${p.strategy}, ${p.exchange}) — ${daysHeld ?? '?'} dni, cel +${p.target}%, stop -${p.stopLoss}%, RSI wejścia: ${p.entryRsi ?? '?'}, max horyzont: ${HORIZON[p.strategy] ?? 30} dni`
  }).join('\n') || 'Brak otwartych pozycji'

  const prompt = `Jesteś Learning Agentem systemu analizy technicznej GPW/NYSE.
Analizujesz realne wyniki zamkniętych pozycji i stan otwartych.

═══ ZAMKNIĘTE POZYCJE — PODSUMOWANIE PER STRATEGIA ═══
${stratSummary}

═══ ZAMKNIĘTE POZYCJE — SZCZEGÓŁY (${details.length} pozycji) ═══
${JSON.stringify(details, null, 2)}

═══ OTWARTE POZYCJE (${openPositions.length}) ═══
${openCtx}

═══ KONTEKST SYSTEMU ═══
Strategie:
- scalping: RSI(9) w oknie [34,46] GPW / [35,50] NYSE, price > SMA50, blisko SMA20, vol ≥ 1.1x. Cel +5%, stop -3%, horyzont 2-5 dni.
- swing (PULLBACK_TO_SMA50): cena ±3-5% od SMA50, RSI(14) [36,55] GPW / [40,58] NYSE, vol ≥ 1.1x. Cel +15%, stop -5%, horyzont 4-8 tyg.
- aggressive (BREAKOUT): cena > max20d, RSI [60,70] GPW / [60,75] NYSE, vol ≥ 2.0-2.5x. Cel +35%, stop -8%.

Parametry które można kalibrować (podaj zmiany TYLKO jeśli dane to uzasadniają):
- scalping: rsi_threshold_min (dolna granica RSI), rsi_threshold (górna granica RSI), volume_multiplier
- swing: swing_volume_multiplier
- aggressive: rsi_min, rsi_max, aggressive_volume_multiplier

Zadanie:
1. Który wzorzec RSI / wolumenu / daysHeld koreluje ze stratami?
2. Czy są otwarte pozycje które powinny być zamknięte (przekroczony horyzont)?
3. Jakie korekty progów uzasadniają dane? (tylko jeśli min. 5 pozycji w strategii)
4. Napisz konkretny wniosek edukacyjny który pomoże Adamowi podejmować lepsze decyzje.

Odpowiedz TYLKO w JSON bez żadnego tekstu:
{
  "insights": "string po polsku, max 4 zdania — konkretne wnioski z danych P&L",
  "loss_pattern": "string — główna przyczyna strat lub null jeśli za mało danych",
  "open_position_warnings": ["ticker: powód" lub pustą tablicę],
  "threshold_recommendations": {
    "GPW":  { "rsi_threshold_min": number|null, "rsi_threshold": number|null, "volume_multiplier": number|null, "swing_volume_multiplier": number|null },
    "NYSE": { "rsi_threshold_min": number|null, "rsi_threshold": number|null, "volume_multiplier": number|null, "swing_volume_multiplier": number|null }
  },
  "recommendation_confidence": number (0-100),
  "best_strategy": "scalping|swing|aggressive|null",
  "worst_strategy": "scalping|swing|aggressive|null"
}`

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: 'Jesteś Learning Agentem GPW Analyzer. Analizujesz realne P&L pozycji. Zwracasz wyłącznie JSON.',
    messages: [{ role: 'user', content: prompt }],
  })

  const text  = response.content[0].text
  const match = text?.match(/\{[\s\S]*\}/)
  if (!match) throw new Error(`Invalid JSON from Learning Agent: ${text?.slice(0, 100)}`)
  return JSON.parse(match[0])
}

export function formatWeeklyReport({ posReport, aiResult, totalAlerts }) {
  const { perStrategy, bestPosition, worstPosition, openSummary, overduePositions, totalClosed, totalOpen } = posReport

  const stratLine = s => {
    const d = perStrategy[s]
    if (!d || d.total === 0) return `${_icon(s)} ${_label(s)}: brak danych`
    return `${_icon(s)} ${_label(s)}: ${d.wins}W/${d.losses}L (${d.winRate}%) | śr. zysk ${d.avgWin ?? '—'}% | śr. strata ${d.avgLoss ?? '—'}%`
  }

  const openSection = totalOpen === 0 ? '📭 Brak otwartych pozycji' : [
    `📂 Otwarte: ${totalOpen} pozycji`,
    ...overduePositions.map(p => `⏰ ${p.ticker} (${p.strategy}) — ${p.daysHeld}/${p.maxDays} dni — PRZEKROCZONY HORYZONT`),
    overduePositions.length === 0 ? '✅ Żadna nie przekroczyła horyzontu' : '',
  ].filter(Boolean).join('\n')

  const recSection = _buildRecommendationSection(aiResult)

  const warningsSection = aiResult?.open_position_warnings?.length
    ? '\n⚠️ <b>OSTRZEŻENIA AI:</b>\n' + aiResult.open_position_warnings.map(w => `• ${w}`).join('\n')
    : ''

  return `🧠 <b>RAPORT TYGODNIOWY — Learning Agent</b>

📊 <b>WYNIKI ZAMKNIĘTYCH POZYCJI (${totalClosed}):</b>
${stratLine('scalping')}
${stratLine('swing')}
${stratLine('aggressive')}

🏆 <b>NAJLEPSZA:</b> ${bestPosition ? `${bestPosition.ticker} ${bestPosition._pnl > 0 ? '+' : ''}${bestPosition._pnl}%` : 'N/A'}
📉 <b>NAJSŁABSZA:</b> ${worstPosition ? `${worstPosition.ticker} ${worstPosition._pnl > 0 ? '+' : ''}${worstPosition._pnl}%` : 'N/A'}

${openSection}${warningsSection}

💡 <b>WNIOSEK AI:</b>
${aiResult?.insights ?? 'Brak wniosków — za mało danych.'}
${aiResult?.loss_pattern ? `\n⚠️ <b>WZORZEC STRAT:</b> ${aiResult.loss_pattern}` : ''}

${recSection}
📡 Alertów w bazie: ${totalAlerts}`
}

function _buildRecommendationSection(aiResult) {
  if (!aiResult?.threshold_recommendations) return ''
  const conf = aiResult.recommendation_confidence ?? 0
  if (conf < 60) return `🔧 <b>REKOMENDACJE PROGÓW:</b> za mało danych (pewność AI: ${conf}%) — brak sugestii`
  const r = aiResult.threshold_recommendations
  const lines = []
  for (const [exch, vals] of Object.entries(r)) {
    const parts = Object.entries(vals)
      .filter(([, v]) => v != null)
      .map(([k, v]) => `${k}=${v}`)
    if (parts.length) lines.push(`${exch}: ${parts.join(', ')}`)
  }
  if (!lines.length) return ''
  return `🔧 <b>REKOMENDOWANE KOREKTY PROGÓW</b> (pewność: ${conf}%, wymaga zatwierdzenia):\n${lines.join('\n')}\n<i>→ Sprawdź GitHub issue #learning do zatwierdzenia</i>`
}

function _icon(s)  { return { scalping: '⚡', swing: '📈', aggressive: '🚀' }[s] ?? '📊' }
function _label(s) { return { scalping: 'Scalping', swing: 'Swing', aggressive: 'Agresywna' }[s] ?? s }
