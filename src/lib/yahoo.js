import { fetchCandlesStooq } from './stooq.js'
import { fetchCandlesTwelveData } from './twelvedata.js'

const TICKER_MAP = {
  'kghm.pl':   'KGH.WA',
  'mwig40.pl': 'MWIG40.WA',
  'swig80.pl': 'SWIG80.WA',
}

const ETF_TICKER_MAP = {
  'vwce': 'VWCE.L',
  'cspx': 'CSPX.L',
  'eqqq': 'EQQQ.L',
  'eunl': 'EUNL.L',
  'vhyl': 'VHYL.L',
  'vwrl': 'VWRL.L',
}

export function toYahooSymbol(ticker, exchange = 'GPW') {
  if (exchange === 'ETF') {
    const t = ticker.toLowerCase()
    return ETF_TICKER_MAP[t] ?? ticker.toUpperCase() + '.L'
  }
  if (exchange === 'NYSE') return ticker.toUpperCase().replace(/\.pl$/i, '')
  const t = ticker.toLowerCase()
  return TICKER_MAP[t] ?? t.replace(/\.pl$/, '').toUpperCase() + '.WA'
}

async function yahooFetch(symbol, range = '1y') {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=${range}&includePrePost=false`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) return null
  return res.json()
}

async function fetchCandlesYahoo(ticker, exchange) {
  const symbol = toYahooSymbol(ticker, exchange)
  const json = await yahooFetch(symbol, '1y')
  const result = json?.chart?.result?.[0]
  if (!result) return null
  const shortName = result.meta?.shortName ?? null
  const ts = result.timestamp ?? []
  const q  = result.indicators.quote[0]
  const candles = ts
    .map((t, i) => ({
      date:   new Date(t * 1000).toISOString().slice(0, 10),
      open:   q.open[i]   ? Math.round(q.open[i]   * 100) / 100 : null,
      high:   q.high[i]   ? Math.round(q.high[i]   * 100) / 100 : null,
      low:    q.low[i]    ? Math.round(q.low[i]    * 100) / 100 : null,
      close:  q.close[i]  ? Math.round(q.close[i]  * 100) / 100 : null,
      volume: q.volume[i] ?? null,
    }))
    .filter(c => c.close !== null)
  return { candles, shortName }
}

export async function fetchCandlesExtended(ticker, exchange = 'GPW', range = '5y') {
  const symbol = toYahooSymbol(ticker, exchange)
  const json   = await yahooFetch(symbol, range)
  const result = json?.chart?.result?.[0]
  if (!result) return null
  const shortName = result.meta?.shortName ?? null
  const ts = result.timestamp ?? []
  const q  = result.indicators.quote[0]
  const candles = ts
    .map((t, i) => ({
      date:   new Date(t * 1000).toISOString().slice(0, 10),
      open:   q.open[i]   ? Math.round(q.open[i]   * 100) / 100 : null,
      high:   q.high[i]   ? Math.round(q.high[i]   * 100) / 100 : null,
      low:    q.low[i]    ? Math.round(q.low[i]    * 100) / 100 : null,
      close:  q.close[i]  ? Math.round(q.close[i]  * 100) / 100 : null,
      volume: q.volume[i] ?? null,
    }))
    .filter(c => c.close !== null)
  return { candles, shortName }
}

export async function fetchCandles(ticker, exchange = 'GPW') {
  if (exchange === 'GPW') {
    const data = await fetchCandlesStooq(ticker).catch(() => null)
    if (data) return data
  }
  if (exchange === 'NYSE') {
    const data = await fetchCandlesTwelveData(ticker).catch(() => null)
    if (data) return data
  }
  return fetchCandlesYahoo(ticker, exchange)
}

export async function fetchCurrent(ticker, exchange = 'GPW') {
  const symbol = toYahooSymbol(ticker, exchange)
  const json = await yahooFetch(symbol, '5d')
  const result = json?.chart?.result?.[0]
  const meta = result?.meta
  if (!meta) return null
  return {
    close:     meta.regularMarketPrice ?? null,
    open:      meta.regularMarketOpen  ?? null,
    high:      meta.regularMarketDayHigh  ?? null,
    low:       meta.regularMarketDayLow   ?? null,
    volume:    meta.regularMarketVolume   ?? null,
    date:      new Date(meta.regularMarketTime * 1000).toISOString().slice(0, 10),
    Close:     String(meta.regularMarketPrice ?? 'N/D'),
    Open:      String(meta.regularMarketOpen  ?? 'N/D'),
    shortName: result.meta?.shortName ?? null,
  }
}

export async function fetchFundamentals(ticker, exchange = 'GPW') {
  const symbol   = toYahooSymbol(ticker, exchange)
  const tsToDate = ts => ts ? new Date(ts * 1000).toISOString().slice(0, 10) : null

  // Step 1: meta (price, currency, shortName) — range=5d proven to work from Vercel IPs
  const metaJson = await yahooFetch(symbol, '5d')
  const metaRes  = metaJson?.chart?.result?.[0]
  if (!metaRes) return null
  const meta  = metaRes.meta ?? {}
  const price = meta.regularMarketPrice ?? null

  // Step 2: dividend events — separate call with range=2y&events=div
  let divYield = null
  let exDivDate = null
  try {
    const divUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=2y&includePrePost=false&events=div`
    const divRes = await fetch(divUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (divRes.ok) {
      const divJson   = await divRes.json()
      const divResult = divJson?.chart?.result?.[0]
      const divEvents = Object.values(divResult?.events?.dividends ?? {})
      const nowSec    = Date.now() / 1000
      const yearAgo   = nowSec - 365 * 24 * 3600

      const pastDivs  = divEvents.filter(d => d.date >= yearAgo && d.date <= nowSec)
      const annualDiv = pastDivs.reduce((sum, d) => sum + (d.amount ?? 0), 0)
      if (price && annualDiv > 0) divYield = annualDiv / price

      const future = divEvents.filter(d => d.date > nowSec).sort((a, b) => a.date - b.date)
      if (future[0]) exDivDate = tsToDate(future[0].date)
    }
  } catch { /* dividend data optional — signal still works without it */ }

  // Step 3: payout ratio via FMP (NYSE only — GPW not in free tier)
  let payoutRatio = null
  const fmpKey = typeof process !== 'undefined' ? process.env?.FMP_API_KEY : null
  if (fmpKey && exchange === 'NYSE') {
    try {
      const fmpRes = await fetch(
        `https://financialmodelingprep.com/stable/ratios-ttm?symbol=${encodeURIComponent(symbol)}&apikey=${fmpKey}`,
        { headers: { 'User-Agent': 'Mozilla/5.0' } }
      )
      if (fmpRes.ok) {
        const fmpJson = await fmpRes.json()
        const r = Array.isArray(fmpJson) ? fmpJson[0] : null
        if (r && typeof r.dividendPayoutRatioTTM === 'number') {
          payoutRatio = r.dividendPayoutRatioTTM
        }
      }
    } catch { /* FMP optional */ }
  }

  return {
    price,
    currency:                 meta.currency ?? null,
    shortName:                meta.shortName ?? meta.longName ?? null,
    dividendYield:            divYield,
    payoutRatio,
    forwardPE:                null,
    trailingPE:               null,
    exDividendDate:           exDivDate,
    dividendDate:             null,
    fiveYearAvgDividendYield: null,
  }
}
