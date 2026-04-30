export function generateAlertReport(alerts) {
  const byStrategy = {}
  for (const a of alerts) {
    if (!byStrategy[a.strategy]) byStrategy[a.strategy] = { hit: 0, total: 0 }
    byStrategy[a.strategy].total++
    if (a.targetAchieved) byStrategy[a.strategy].hit++
  }

  const byTicker = {}
  for (const a of alerts) {
    if (!byTicker[a.ticker]) byTicker[a.ticker] = { hit: 0, total: 0 }
    byTicker[a.ticker].total++
    if (a.targetAchieved) byTicker[a.ticker].hit++
  }

  const tickerStats = Object.entries(byTicker).map(([ticker, s]) => ({
    ticker,
    ...s,
    pct: s.total > 0 ? Math.round((s.hit / s.total) * 100) : 0,
  }))

  tickerStats.sort((a, b) => b.pct - a.pct)

  return {
    byStrategy,
    bestStock:  tickerStats[0] ?? { ticker: 'N/A', pct: 0 },
    worstStock: tickerStats[tickerStats.length - 1] ?? { ticker: 'N/A', pct: 0 },
    focusTickers: tickerStats.slice(0, 3).map(t => t.ticker),
  }
}
