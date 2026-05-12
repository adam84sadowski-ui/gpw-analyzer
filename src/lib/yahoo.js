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
  const symbol = toYahooSymbol(ticker, exchange)
  // v8/chart with events=div — works without crumb, returns dividends + meta
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1y&includePrePost=false&events=div`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) return null
  const json = await res.json()
  const result = json?.chart?.result?.[0]
  if (!result) return null

  const meta   = result.meta ?? {}
  const price  = meta.regularMarketPrice ?? null
  const tsToDate = ts => ts ? new Date(ts * 1000).toISOString().slice(0, 10) : null

  // Dividend events: Yahoo returns both past and upcoming declared dividends
  const divEvents  = Object.values(result.events?.dividends ?? {})
  const nowSec     = Date.now() / 1000
  const yearAgoSec = nowSec - 365 * 24 * 3600

  const pastDivs   = divEvents.filter(d => d.date >= yearAgoSec && d.date <= nowSec)
  const annualDiv  = pastDivs.reduce((sum, d) => sum + (d.amount ?? 0), 0)
  const divYield   = price && annualDiv > 0 ? annualDiv / price : null

  const futureDivs = divEvents.filter(d => d.date > nowSec).sort((a, b) => a.date - b.date)
  const exDivDate  = futureDivs[0] ? tsToDate(futureDivs[0].date) : null

  return {
    price,
    currency:                 meta.currency ?? null,
    shortName:                meta.shortName ?? meta.longName ?? null,
    dividendYield:            divYield,
    payoutRatio:              null,   // unavailable without Yahoo crumb
    forwardPE:                null,
    trailingPE:               null,
    exDividendDate:           exDivDate,
    dividendDate:             null,
    fiveYearAvgDividendYield: null,
  }
}
