export async function fetchSeasonalityData(ticker, exchange) {
  const symbol = exchange === 'NYSE'
    ? ticker.toUpperCase()
    : ticker.replace(/\.pl$/i, '').toUpperCase() + '.WA'
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=5y&includePrePost=false`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) return null
  const json = await res.json()
  const result = json?.chart?.result?.[0]
  if (!result) return null
  const ts     = result.timestamp ?? []
  const closes = result.indicators.quote[0].close ?? []
  return ts
    .map((t, i) => ({ date: new Date(t * 1000).toISOString().slice(0, 10), close: closes[i] }))
    .filter(c => c.close != null && !isNaN(c.close))
}

export function calculateMonthlyReturns(prices) {
  const groups = Array.from({ length: 12 }, () => [])
  for (let i = 1; i < prices.length; i++) {
    const prevMonth = new Date(prices[i - 1].date).getMonth()
    const currMonth = new Date(prices[i].date).getMonth()
    if (prevMonth !== currMonth && prices[i - 1].close > 0) {
      const ret = (prices[i].close - prices[i - 1].close) / prices[i - 1].close * 100
      groups[currMonth].push(ret)
    }
  }
  const result = {}
  for (let m = 0; m < 12; m++) {
    const vals = groups[m]
    result[m] = vals.length > 0
      ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 100) / 100
      : 0
  }
  return result
}

export function getSeasonalityScore(monthlyReturns, currentMonth) {
  if (!monthlyReturns) return { score: 0, avgReturn: null }
  const ret = monthlyReturns[currentMonth]
  if (ret == null) return { score: 0, avgReturn: null }
  let score = 0
  if (ret > 1.5)       score =  10
  else if (ret > 0.5)  score =   5
  else if (ret < -1.5) score = -10
  else if (ret < -0.5) score =  -5
  return { score, avgReturn: ret }
}
