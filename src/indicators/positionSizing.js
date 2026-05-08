const SCORE_MULTIPLIERS = [
  { min: 80, multiplier: 1.00 },
  { min: 70, multiplier: 0.75 },
  { min: 60, multiplier: 0.50 },
]

export function calcPositionSize(portfolio, maxPct, score, drawdownPct = 0, totalExposurePct = 0) {
  if (score < 60)           return { blocked: true, reason: 'score_low',  size: 0, pct: 0, scoreMultiplier: 0 }
  if (drawdownPct > 15)     return { blocked: true, reason: 'drawdown',   size: 0, pct: 0, scoreMultiplier: 0 }
  if (totalExposurePct > 60) return { blocked: true, reason: 'exposure',  size: 0, pct: 0, scoreMultiplier: 0 }

  const scoreMultiplier = SCORE_MULTIPLIERS.find(s => score >= s.min)?.multiplier ?? 0.50
  const base            = portfolio * maxPct / 100
  const size            = Math.round(base * scoreMultiplier)
  const pct             = Math.round(size / portfolio * 1000) / 10

  return { blocked: false, size, pct, scoreMultiplier, reason: null }
}

export function formatPositionSizingLine(result, price, currency) {
  if (result.blocked) {
    const reasons = {
      score_low: 'score < 60 — sygnał za słaby',
      drawdown:  'drawdown portfela > 15% — brak nowych pozycji',
      exposure:  'ekspozycja > 60% portfela — limit osiągnięty',
    }
    return `🚫 Pozycja zablokowana: ${reasons[result.reason] ?? result.reason}`
  }
  const shares     = price > 0 ? Math.floor(result.size / price) : 0
  const multiplier = result.scoreMultiplier < 1 ? ` (${result.scoreMultiplier * 100}% bazy — score < ${result.scoreMultiplier === 0.75 ? 80 : 70})` : ''
  return [
    `💰 POZYCJA: ${result.size.toLocaleString('pl-PL')} ${currency} (~${result.pct}% portfela)${multiplier}`,
    shares > 0 ? `📌 ~${shares} akcji po ${price} ${currency}` : '',
  ].filter(Boolean).join('\n')
}
