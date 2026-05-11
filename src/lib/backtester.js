import { detectSignal } from './signals.js'

/**
 * Compute all backtest metrics from completed trades and equity curve.
 * Pure function — no side effects.
 */
export function calcMetrics(trades, equityCurve) {
  const winners = trades.filter(t => t.gainPct > 0)
  const losers  = trades.filter(t => t.gainPct <= 0)

  const winRate      = trades.length ? Math.round(winners.length / trades.length * 1000) / 10 : 0
  const avgGain      = trades.length ? Math.round(trades.reduce((s, t) => s + t.gainPct, 0) / trades.length * 100) / 100 : 0
  const avg_win_pct  = winners.length ? Math.round(winners.reduce((s, t) => s + t.gainPct, 0) / winners.length * 100) / 100 : 0
  const avg_loss_pct = losers.length  ? Math.round(losers.reduce((s, t) => s + t.gainPct, 0) / losers.length * 100) / 100 : 0

  const grossWin     = winners.reduce((s, t) => s + t.gainPct, 0)
  const grossLoss    = Math.abs(losers.reduce((s, t) => s + t.gainPct, 0))
  const profit_factor = grossLoss > 0 ? Math.round(grossWin / grossLoss * 100) / 100 : null

  // Sharpe ratio (annualised, daily equity returns, 0% risk-free)
  const equityReturns = []
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1].equity
    if (prev > 0) equityReturns.push((equityCurve[i].equity - prev) / prev)
  }
  let sharpe_ratio = null
  if (equityReturns.length > 1) {
    const mean     = equityReturns.reduce((s, r) => s + r, 0) / equityReturns.length
    const variance = equityReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / equityReturns.length
    const std      = Math.sqrt(variance)
    sharpe_ratio   = std > 0 ? Math.round(mean / std * Math.sqrt(252) * 100) / 100 : null
  }

  // Max drawdown
  let peak = 100, maxDrawdown = 0
  for (const p of equityCurve) {
    if (p.equity > peak) peak = p.equity
    const dd = (peak - p.equity) / peak * 100
    if (dd > maxDrawdown) maxDrawdown = dd
  }
  maxDrawdown = Math.round(maxDrawdown * 100) / 100

  // Per-year breakdown
  const yearMap = {}
  for (const t of trades) {
    const year = t.exitDate.slice(0, 4)
    if (!yearMap[year]) yearMap[year] = { trades: 0, wins: 0, totalGain: 0 }
    yearMap[year].trades++
    if (t.gainPct > 0) yearMap[year].wins++
    yearMap[year].totalGain += t.gainPct
  }
  const yearBreakdown = Object.entries(yearMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([year, s]) => ({
      year,
      trades:    s.trades,
      wins:      s.wins,
      winRate:   s.trades ? Math.round(s.wins / s.trades * 1000) / 10 : 0,
      totalGain: Math.round(s.totalGain * 100) / 100,
    }))

  const best_year  = yearBreakdown.length ? yearBreakdown.reduce((b, y) => y.totalGain > b.totalGain ? y : b) : null
  const worst_year = yearBreakdown.length ? yearBreakdown.reduce((b, y) => y.totalGain < b.totalGain ? y : b) : null

  const sorted = [...trades].sort((a, b) => b.gainPct - a.gainPct)
  const top5   = sorted.slice(0, 5)
  const worst5 = sorted.slice(-5).reverse()

  return {
    winning_trades: winners.length,
    losing_trades:  losers.length,
    winRate, avgGain, avg_win_pct, avg_loss_pct,
    profit_factor, sharpe_ratio, maxDrawdown,
    best_year, worst_year, yearBreakdown, top5, worst5,
  }
}

/**
 * Rolling backtest simulation.
 *
 * @param {Array}    candles     OHLCV array, min 55 entries required
 * @param {string}   strategy   'scalping' | 'swing' | 'aggressive'
 * @param {object}   config     { target: number, stopLoss: number }
 * @param {number}   maxDays    max holding days before horizon exit
 * @param {string}   exchange   'GPW' | 'NYSE'
 * @param {Function} detectFn   optional override for detectSignal (for testing)
 * @returns {{ trades, equityCurve }}
 */
export function runSimulation(candles, strategy, config, maxDays, exchange = 'GPW', detectFn) {
  if (!candles || candles.length < 55) throw new Error('Za mało danych historycznych')

  const detector = detectFn ?? ((slice, strat) =>
    detectSignal(slice, strat, {}, exchange, 'neutral', null)
  )

  const trades      = []
  let   inTrade     = null
  let   equity      = 100
  const equityCurve = [{ date: candles[55].date, equity: 100 }]

  for (let i = 55; i < candles.length; i++) {
    const c = candles[i]

    if (inTrade) {
      const daysSince = i - inTrade.startIdx
      let exitPrice   = c.close
      let exitReason  = null

      if (c.low  != null && c.low  <= inTrade.stopPrice)  { exitReason = 'stop';    exitPrice = inTrade.stopPrice   }
      if (c.high != null && c.high >= inTrade.targetPrice) { exitReason = 'target';  exitPrice = inTrade.targetPrice }
      if (daysSince >= maxDays && !exitReason)             { exitReason = 'horizon'; exitPrice = c.close             }

      if (exitReason) {
        const gainPct = Math.round((exitPrice - inTrade.entry) / inTrade.entry * 10000) / 100
        equity        = Math.round(equity * (1 + gainPct / 100) * 100) / 100
        trades.push({ entryDate: inTrade.startDate, exitDate: c.date, entry: inTrade.entry, exit: exitPrice, gainPct, exitReason })
        inTrade = null
      }
    }

    if (!inTrade) {
      const sig = detector(candles.slice(0, i + 1), strategy)
      if (sig) {
        const entry = c.close
        inTrade = {
          entry, startIdx: i, startDate: c.date,
          stopPrice:   Math.round(entry * (1 - (sig.dynamicStopLoss ?? config.stopLoss) / 100) * 100) / 100,
          targetPrice: Math.round(entry * (1 + config.target / 100) * 100) / 100,
        }
      }
    }

    equityCurve.push({ date: c.date, equity })
  }

  return { trades, equityCurve }
}
