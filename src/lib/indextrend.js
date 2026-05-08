import { fetchCandlesStooq } from './stooq.js'

async function fetchIndexCandlesStooq(symbol) {
  const url = `https://stooq.com/q/d/l/?s=${symbol}&i=d`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) return null
  const csv = await res.text()
  if (!csv || csv.includes('No data') || !csv.includes(',')) return null
  const lines = csv.trim().split('\n')
  const candles = lines.slice(1).map(line => {
    const [date, , , , close] = line.split(',')
    return { date: date?.trim(), close: parseFloat(close) }
  }).filter(c => c.date && !isNaN(c.close) && c.close > 0)
  return candles.length >= 55 ? candles.slice(-252) : null
}

async function fetchIndexCandlesYahoo(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1y&includePrePost=false`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) return null
  const json = await res.json()
  const result = json?.chart?.result?.[0]
  if (!result) return null
  const ts = result.timestamp ?? []
  const closes = result.indicators.quote[0].close ?? []
  const candles = ts.map((t, i) => ({ date: new Date(t * 1000).toISOString().slice(0, 10), close: closes[i] }))
    .filter(c => c.close != null && !isNaN(c.close))
  return candles.length >= 55 ? candles : null
}

function trendFromCandles(candles) {
  if (!candles || candles.length < 55) return 'neutral'
  const closes = candles.map(c => c.close)
  const price = closes[closes.length - 1]
  const sma50 = closes.slice(-50).reduce((a, b) => a + b, 0) / 50
  if (price > sma50 * 1.005) return 'up'
  if (price < sma50 * 0.98)  return 'down'
  return 'neutral'
}

export async function fetchIndexTrend(exchange) {
  try {
    if (exchange === 'GPW') {
      const candles = await fetchIndexCandlesStooq('wig20')
      return trendFromCandles(candles)
    }
    const candles = await fetchIndexCandlesYahoo('SPY')
    return trendFromCandles(candles)
  } catch {
    return 'neutral'
  }
}
