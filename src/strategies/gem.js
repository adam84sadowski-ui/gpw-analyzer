export const GEM_ETFS = {
  usa:   { ticker: 'cspx', symbol: 'CSPX.L', name: 'iShares Core S&P 500',               shortName: 'CSPX', isin: 'IE00B5BMR087' },
  world: { ticker: 'swrd', symbol: 'SWRD.L', name: 'SPDR MSCI World',                    shortName: 'SWRD', isin: 'IE00BFY0GT14' },
  bonds: { ticker: 'aggh', symbol: 'AGGH.L', name: 'iShares Core Global Aggregate Bond', shortName: 'AGGH', isin: 'IE00BDBRDM35' },
  dca:   { ticker: 'vwce', symbol: 'VWCE.L', name: 'Vanguard FTSE All-World',            shortName: 'VWCE', isin: 'IE00BK5BQT80' },
}

// Find closest price to targetDate within ±45 days
function findPriceAtDate(candles, targetDate) {
  if (!candles?.length) return null
  let closest = null, minDiff = Infinity
  for (const c of candles) {
    if (!c.close) continue
    const diff = Math.abs(new Date(c.date) - targetDate)
    if (diff < minDiff) { minDiff = diff; closest = c }
  }
  return minDiff <= 45 * 86400000 ? closest : null
}

// Return fraction (e.g. 0.18 for +18%) over lookbackMonths ending at latest candle
export function calculateReturn12m(candles, lookbackMonths = 12) {
  if (!candles?.length) return null
  const latest = candles[candles.length - 1]
  if (!latest?.close) return null
  const target = new Date(latest.date)
  target.setMonth(target.getMonth() - lookbackMonths)
  const past = findPriceAtDate(candles, target)
  if (!past?.close) return null
  return (latest.close - past.close) / past.close
}

// Returns true when date is the last business day of its calendar month
export function isLastBusinessDay(date = new Date()) {
  const day = date.getDay()
  if (day === 0 || day === 6) return false
  const lastBD = new Date(date.getFullYear(), date.getMonth() + 1, 0)
  while (lastBD.getDay() === 0 || lastBD.getDay() === 6) lastBD.setDate(lastBD.getDate() - 1)
  return date.getDate() === lastBD.getDate() && date.getMonth() === lastBD.getMonth()
}

// Last business day of next calendar month
export function nextReviewDate(from = new Date()) {
  const lastBD = new Date(from.getFullYear(), from.getMonth() + 2, 0)
  while (lastBD.getDay() === 0 || lastBD.getDay() === 6) lastBD.setDate(lastBD.getDate() - 1)
  return lastBD.toISOString().slice(0, 10)
}

// Core GEM algorithm (Gary Antonacci)
// cashRate: decimal fraction (e.g. 0.0575 for 5.75%)
export function runGEMAlgorithm(cspxCandles, swrdCandles, cashRate, lookbackMonths = 12) {
  const cspx12m = calculateReturn12m(cspxCandles, lookbackMonths)
  if (cspx12m === null) return null

  if (cspx12m < cashRate) {
    return {
      decision:    'bonds',
      etf:         'AGGH',
      etfName:     GEM_ETFS.bonds.name,
      cspx12m,
      swrd12m:     null,
      cashRate,
      step1Passed: false,
      reason:      `CSPX ${(cspx12m * 100).toFixed(1)}% < gotówka ${(cashRate * 100).toFixed(1)}%`,
      lookback:    lookbackMonths,
      timestamp:   new Date().toISOString(),
    }
  }

  const swrd12m = calculateReturn12m(swrdCandles, lookbackMonths)
  if (swrd12m === null) return null

  if (swrd12m > cspx12m) {
    return {
      decision:    'world',
      etf:         'SWRD',
      etfName:     GEM_ETFS.world.name,
      cspx12m,
      swrd12m,
      cashRate,
      step1Passed: true,
      reason:      `SWRD ${(swrd12m * 100).toFixed(1)}% > CSPX ${(cspx12m * 100).toFixed(1)}%`,
      lookback:    lookbackMonths,
      timestamp:   new Date().toISOString(),
    }
  }

  return {
    decision:    'usa',
    etf:         'CSPX',
    etfName:     GEM_ETFS.usa.name,
    cspx12m,
    swrd12m,
    cashRate,
    step1Passed: true,
    reason:      `CSPX ${(cspx12m * 100).toFixed(1)}% >= SWRD ${(swrd12m * 100).toFixed(1)}%`,
    lookback:    lookbackMonths,
    timestamp:   new Date().toISOString(),
  }
}

// Convert daily candles → last-day-of-month candles, sorted ascending
function toMonthlyCandles(candles) {
  if (!candles?.length) return []
  const monthly = {}
  for (const c of candles) {
    if (!c.close) continue
    monthly[c.date.slice(0, 7)] = c
  }
  return Object.entries(monthly)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, c]) => c)
}

// Historical GEM backtest — returns equity curves starting from 100
export function simulateGEM(cspxCandles, swrdCandles, agghCandles, vwceCandles, {
  cashRate = 0.0575,
  lookback = 12,
  gemPct   = 0.7,
} = {}) {
  const cspxM = toMonthlyCandles(cspxCandles)
  const swrdM = toMonthlyCandles(swrdCandles)
  const agghM = toMonthlyCandles(agghCandles ?? [])
  const vwceM = toMonthlyCandles(vwceCandles)

  if (cspxM.length < lookback + 2 || vwceM.length < 2) return null

  const dcaPct = 1 - gemPct

  const priceAt = (monthly, yyyyMM) => monthly.find(c => c.date.slice(0, 7) === yyyyMM)?.close ?? null

  let gemVal = 100, vwceVal = 100, cspxVal = 100
  const curve = []

  for (let i = lookback; i < cspxM.length - 1; i++) {
    const cur  = cspxM[i].date.slice(0, 7)
    const next = cspxM[i + 1].date.slice(0, 7)

    const cspxHist = cspxM.slice(0, i + 1)
    const swrdHist = swrdM.filter(c => c.date.slice(0, 7) <= cur)

    const sig = runGEMAlgorithm(cspxHist, swrdHist.length > lookback ? swrdHist : cspxHist, cashRate, lookback)

    const monthlyRet = (monthly, key1, key2) => {
      const p1 = priceAt(monthly, key1), p2 = priceAt(monthly, key2)
      return p1 && p2 ? (p2 - p1) / p1 : 0
    }

    const cspxRet = monthlyRet(cspxM, cur, next)
    const swrdRet = monthlyRet(swrdM, cur, next)
    const agghRet = agghM.length ? monthlyRet(agghM, cur, next) : 0
    const vwceRet = monthlyRet(vwceM, cur, next)

    let gemPartRet = cspxRet
    if (sig?.decision === 'world') gemPartRet = swrdRet
    if (sig?.decision === 'bonds') gemPartRet = agghRet

    gemVal  *= 1 + gemPct * gemPartRet + dcaPct * vwceRet
    vwceVal *= 1 + vwceRet
    cspxVal *= 1 + cspxRet

    curve.push({
      date:    next,
      gem:     Math.round(gemVal  * 10) / 10,
      vwce:    Math.round(vwceVal * 10) / 10,
      cspx:    Math.round(cspxVal * 10) / 10,
      holding: sig?.etf ?? 'CSPX',
    })
  }

  if (!curve.length) return null
  return {
    curve,
    startDate:  curve[0].date,
    endDate:    curve[curve.length - 1].date,
    gemReturn:  Math.round((gemVal  - 100) * 10) / 10,
    vwceReturn: Math.round((vwceVal - 100) * 10) / 10,
    cspxReturn: Math.round((cspxVal - 100) * 10) / 10,
  }
}
