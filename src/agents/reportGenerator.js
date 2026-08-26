const HORIZON_DAYS = { scalping: 5, swing: 40, aggressive: 30 }

export function buildPositionReport(closedPositions = [], openPositions = []) {
  // ── Per-strategy stats from closed positions ──────────────────────────────
  const perStrategy = {}
  for (const p of closedPositions) {
    const s = p.strategy ?? 'unknown'
    if (!perStrategy[s]) perStrategy[s] = { wins: 0, losses: 0, total: 0, sumWin: 0, sumLoss: 0 }
    const pnl = _pnl(p)
    if (pnl == null) continue
    perStrategy[s].total++
    if (pnl >= 0) { perStrategy[s].wins++;  perStrategy[s].sumWin  += pnl }
    else           { perStrategy[s].losses++; perStrategy[s].sumLoss += pnl }
  }
  for (const s of Object.values(perStrategy)) {
    s.winRate = s.total > 0 ? Math.round(s.wins / s.total * 100) : 0
    s.avgWin  = s.wins   > 0 ? Math.round(s.sumWin  / s.wins   * 10) / 10 : null
    s.avgLoss = s.losses > 0 ? Math.round(s.sumLoss / s.losses * 10) / 10 : null
  }

  // ── Best / worst closed positions ─────────────────────────────────────────
  const ranked = closedPositions
    .map(p => ({ ...p, _pnl: _pnl(p) }))
    .filter(p => p._pnl != null)
    .sort((a, b) => b._pnl - a._pnl)
  const bestPosition  = ranked[0]  ?? null
  const worstPosition = ranked[ranked.length - 1] ?? null

  // ── Open positions: horizon & exposure ────────────────────────────────────
  const now = Date.now()
  const openSummary = openPositions.map(p => {
    const daysHeld  = p.entryDate ? Math.round((now - new Date(p.entryDate)) / 86400000) : null
    const maxDays   = HORIZON_DAYS[p.strategy] ?? 30
    const overdue   = daysHeld != null && daysHeld > maxDays
    return { ticker: p.ticker, strategy: p.strategy, exchange: p.exchange ?? 'GPW',
             daysHeld, maxDays, overdue, target: p.target, stopLoss: p.stopLoss,
             signal: p.signal, entryRsi: p.entryRsi ?? null }
  })
  const overduePositions = openSummary.filter(p => p.overdue)

  return { perStrategy, bestPosition, worstPosition, openSummary, overduePositions,
           totalClosed: closedPositions.length, totalOpen: openPositions.length }
}

// Legacy — kept for alert-based focusTicker fallback
export function generateAlertReport(alerts = []) {
  const byTicker = {}
  for (const a of alerts) {
    if (!byTicker[a.ticker]) byTicker[a.ticker] = { hit: 0, total: 0 }
    byTicker[a.ticker].total++
    if (a.targetAchieved) byTicker[a.ticker].hit++
  }
  const tickerStats = Object.entries(byTicker)
    .map(([ticker, s]) => ({ ticker, ...s, pct: s.total > 0 ? Math.round(s.hit / s.total * 100) : 0 }))
    .sort((a, b) => b.pct - a.pct)
  return { focusTickers: tickerStats.slice(0, 3).map(t => t.ticker) }
}

function _pnl(p) {
  if (p.pnlPct != null) return p.pnlPct
  if (!p.exitPrice || !p.entryPrice) return null
  const ep = p.avgEntryPrice ?? p.entryPrice
  return Math.round((p.exitPrice - ep) / ep * 10000) / 100
}
